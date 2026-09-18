// Proxies Arcscan's (Blockscout-style) TESTNET explorer API, and now also
// Arc MAINNET's explorer -- which is a completely different service:
// Etherscan itself launched "ArcScan" at arc.etherscan.io for mainnet
// (confirmed 2026-09-18), using Etherscan's own unified V2 API
// (api.etherscan.io/v2/api?chainid=5042&...) rather than the
// unauthenticated Blockscout-style API testnet.arcscan.app uses. That
// means mainnet calls need an API key (ETHERSCAN_API_KEY) and a
// different origin/param shape -- added here as an opt-in `network=mainnet`
// query param rather than a new file, to stay under Vercel's Hobby-plan
// 12-serverless-function cap (already hit twice). Default behavior
// (no `network` param) is untouched testnet, so the seven existing
// pages calling this stay exactly as they were.
//
// Calling either explorer directly from the browser is unreliable — other
// Arc projects have hit the same CORS wall and solved it the same way:
// fetch server-side instead.
//
// Seven different pages (History, Dashboard, Home, Swap, Send, ...) all call this
// same endpoint. The recurring "Explorer API error (429)" users kept hitting — every
// single time they opened History, days in a row — traces to the cache that was
// supposed to prevent this: it lived in a plain in-memory Map, which is per-serverless-
// instance on Vercel. Each invocation can land on a different (or freshly cold) instance
// with its own empty Map, so the cache frequently did nothing at all — every request
// looked like a first request to Arcscan, and retries from concurrent invocations
// compounded the load rather than reducing it. Moved to Upstash Redis (already used
// elsewhere in this app) specifically because it's shared across every instance —
// this is the actual fix, not just a longer TTL or more retries on top of the same
// broken cache.
//
// Two real mitigations:
//   1. A short shared cache, keyed by the exact query (network included) — identical
//      requests within the cache window are served from Redis instead of hitting the
//      explorer again, regardless of which serverless instance handles the request.
//   2. Automatic retries with short backoff specifically on 429, since explorer rate
//      limits are typically a short rolling window — often gone within a second or two.
//
// Also used with ?module=logs&action=getLogs (Blockscout's Etherscan-compatible log
// endpoint) as a fallback source for event logs when eth_getLogs on the RPC itself is
// unreliable (a real, confirmed issue on Arc Testnet's public RPC) — this reads from
// Arcscan's own indexed database instead, same query shape, no extra code needed here.
const { Redis } = require('@upstash/redis');

const ARCSCAN_TESTNET_ORIGIN = 'https://testnet.arcscan.app';
const ETHERSCAN_V2_ORIGIN = 'https://api.etherscan.io';
const ARC_MAINNET_CHAIN_ID = 5042;
const CACHE_TTL_SECONDS = 30;
const RETRY_DELAYS_MS = [0, 600, 1500, 3000, 5000];

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

// Falls back to a plain in-memory Map if Redis isn't configured — still better than
// nothing within a single warm instance, but this is the degraded path, not the fix.
const memCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCached(key) {
  if (redis) {
    const val = await redis.get(`arcscan-cache:${key}`);
    return val ? (typeof val === 'string' ? JSON.parse(val) : val) : null;
  }
  const entry = memCache.get(key);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

async function setCached(key, entry) {
  if (redis) {
    await redis.set(`arcscan-cache:${key}`, JSON.stringify(entry), { ex: CACHE_TTL_SECONDS });
    return;
  }
  memCache.set(key, { ...entry, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const query = req.query || {};
    const isMainnet = query.network === 'mainnet';

    const params = new URLSearchParams();
    for (const key of Object.keys(query)) {
      if (key === 'network') continue; // routing flag only, not forwarded
      const value = query[key];
      if (Array.isArray(value)) {
        params.set(key, value[0]);
      } else if (value !== undefined) {
        params.set(key, value);
      }
    }

    let targetUrl;
    if (isMainnet) {
      if (!process.env.ETHERSCAN_API_KEY) {
        return res.status(500).json({ error: 'Server misconfigured: ETHERSCAN_API_KEY is not set.' });
      }
      params.set('chainid', String(ARC_MAINNET_CHAIN_ID));
      params.set('apikey', process.env.ETHERSCAN_API_KEY);
      targetUrl = `${ETHERSCAN_V2_ORIGIN}/v2/api?${params.toString()}`;
    } else {
      targetUrl = `${ARCSCAN_TESTNET_ORIGIN}/api?${params.toString()}`;
    }

    // Cache key includes which network this is, so testnet and mainnet
    // results for the same module/action/address never collide.
    const cacheKey = `${isMainnet ? 'mainnet' : 'testnet'}:${params.toString()}`;

    const cached = await getCached(cacheKey);
    if (cached) {
      res.status(cached.status);
      res.setHeader('Content-Type', cached.contentType);
      return res.send(cached.body);
    }

    let response = null;
    let text = '';
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);
      response = await fetch(targetUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      text = await response.text();
      if (response.status !== 429) break;
    }

    const contentType = response.headers.get('content-type') || 'application/json';

    // Only cache genuine successes — never cache a 429/5xx, or a real fix would
    // get masked behind a stale error for the rest of the cache window.
    if (response.status >= 200 && response.status < 300) {
      await setCached(cacheKey, { status: response.status, contentType, body: text });
    }

    res.status(response.status);
    res.setHeader('Content-Type', contentType);
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

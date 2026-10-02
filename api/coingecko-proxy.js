// Proxies CoinGecko's public API. CoinGecko doesn't send CORS headers on
// its responses, so every direct browser call to api.coingecko.com was
// failing outright ("blocked by CORS policy") regardless of anything else
// going on client-side — proxying server-side sidesteps CORS entirely,
// same reasoning as api/arcscan-proxy.js and api/rpc-proxy.js.
//
// Also cached (same shared-Redis pattern as arcscan-proxy.js) — CoinGecko's
// free tier rate-limits aggressively, and this endpoint is called from
// several different components (Dashboard, CopilotHome, LiquidityPools,
// MarketTicker, TradingViewChart, ...), any of which loading at once could
// trip a 429 on its own even before considering multiple users.
const { Redis } = require('@upstash/redis');
const { Ratelimit } = require('@upstash/ratelimit');

const COINGECKO_ORIGIN = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_SECONDS = 30;
// Only these path prefixes are reachable — keeps this from becoming an
// open relay to arbitrary CoinGecko endpoints (or, if a typo let it
// through, to a completely different host).
const ALLOWED_PREFIXES = ['/simple/price', '/coins/', '/search'];

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const memCache = new Map();

// Per-IP limit. Without it, anyone could vary the query string to skip the cache and burn
// FlowFi's shared CoinGecko quota, which then 429s for every real user. Generous: several
// components read prices on page load, and cached hits count too.
const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '60 s'), prefix: 'ratelimit:coingecko-proxy' })
  : null;

async function getCached(key) {
  if (redis) {
    const val = await redis.get(`coingecko-cache:${key}`);
    return val ? (typeof val === 'string' ? JSON.parse(val) : val) : null;
  }
  const entry = memCache.get(key);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

async function setCached(key, entry) {
  if (redis) {
    await redis.set(`coingecko-cache:${key}`, JSON.stringify(entry), { ex: CACHE_TTL_SECONDS });
    return;
  }
  memCache.set(key, { ...entry, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (ratelimit) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!(await ratelimit.limit(ip)).success) return res.status(429).json({ error: 'Too many price requests. Please slow down.' });
  }

  const path = req.query.path;
  if (typeof path !== 'string' || !path.startsWith('/') || !ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    return res.status(400).json({ error: 'Missing or unsupported path.' });
  }

  try {
    const cached = await getCached(path);
    if (cached) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(cached.status).send(cached.body);
    }

    const response = await fetch(`${COINGECKO_ORIGIN}${path}`, {
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();

    if (response.status >= 200 && response.status < 300) {
      await setCached(path, { status: response.status, body: text });
    }

    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (error) {
    console.error('coingecko-proxy error:', error?.message);
    res.status(502).json({ error: 'Price data unavailable. Please try again.' });
  }
};

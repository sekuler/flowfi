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
const { Ratelimit } = require('@upstash/ratelimit');

const ARCSCAN_TESTNET_ORIGIN = 'https://testnet.arcscan.app';
const ETHERSCAN_V2_ORIGIN = 'https://api.etherscan.io';
const ARC_MAINNET_CHAIN_ID = 5042;
const CACHE_TTL_SECONDS = 30;
// Was [0, 600, 1500, 3000, 5000] -- up to ~10s of waiting inside one function call, per request.
const RETRY_DELAYS_MS = [0, 800, 2000];

// Only the explorer queries the app actually makes. Without this, anyone could run any
// Etherscan V2 module/action for chain 5042 on FlowFi's own ETHERSCAN_API_KEY quota.
const ALLOWED_ACTIONS = {
  account: new Set(['txlist', 'tokentx', 'txlistinternal', 'balance', 'tokenbalance']),
  logs: new Set(['getLogs']),
};
const ALLOWED_PARAMS = new Set(['module', 'action', 'address', 'contractaddress', 'sort', 'page', 'offset', 'limit', 'startblock', 'endblock', 'fromBlock', 'toBlock', 'topic0', 'tag']);

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

// Falls back to a plain in-memory Map if Redis isn't configured — still better than
// nothing within a single warm instance, but this is the degraded path, not the fix.
const memCache = new Map();

// Per-IP limit, same shared-Redis pattern as the other endpoints. Generous: pages call this
// on load and on refresh, and cached hits still count (cheap, but not free).
const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '60 s'), prefix: 'ratelimit:arcscan-proxy' })
  : null;

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


// ---- Arc mainnet history via Alchemy -------------------------------------------------------------------------
// Etherscan's free API stopped covering Arc mainnet (chain 5042): since Oct 2026 every call returns
// "Free API access is not supported for this chain". Alchemy's Transfers API does cover Arc mainnet on its free
// plan (confirmed 2026-10-20 with alchemy_getAssetTransfers against a real wallet), so when ALCHEMY_API_KEY is set,
// the two history queries the app makes (txlist, tokentx) are answered from Alchemy and returned in the same
// Etherscan shape the pages already read. Nothing changes in the frontend.
const ALCHEMY_ARC_URL = 'https://arc-mainnet.g.alchemy.com/v2/';
const ALCHEMY_ACTIONS = new Set(['txlist', 'tokentx']);

async function alchemyCall(body) {
  const r = await fetch(ALCHEMY_ARC_URL + process.env.ALCHEMY_API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Alchemy ${r.status}`);
  return r.json();
}

async function assetTransfers(filter) {
  const d = await alchemyCall({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [{ withMetadata: true, order: 'desc', ...filter }] });
  if (d.error) throw new Error(d.error.message || 'Alchemy error');
  return d.result?.transfers ?? [];
}

const toSecs = (t) => String(Math.floor(new Date(t?.metadata?.blockTimestamp ?? 0).getTime() / 1000));
const hexToDec = (h) => { try { return BigInt(h).toString(); } catch { return '0'; } };

// Both directions, newest first, without duplicates (a self-transfer shows up in both lists).
async function bothDirections(address, filter, count) {
  const maxCount = '0x' + count.toString(16);
  const [out, inn] = await Promise.all([
    assetTransfers({ ...filter, fromAddress: address, maxCount }),
    assetTransfers({ ...filter, toAddress: address, maxCount }),
  ]);
  const seen = new Map();
  for (const t of [...out, ...inn]) if (!seen.has(t.uniqueId)) seen.set(t.uniqueId, t);
  return [...seen.values()].sort((a, b) => Number(BigInt(b.blockNum) - BigInt(a.blockNum)));
}

// Etherscan "txlist": the wallet's own transactions with input data and status, which the History page uses to
// tell a swap, a deposit or an approval apart. Alchemy gives the hashes; the details come from one batched RPC call.
async function alchemyTxlist(address, count) {
  const transfers = await bothDirections(address, { category: ['external'], excludeZeroValue: false }, count);
  const byHash = new Map();
  for (const t of transfers) if (!byHash.has(t.hash)) byHash.set(t.hash, t);
  const hashes = [...byHash.keys()].slice(0, count);
  if (!hashes.length) return [];
  const batch = hashes.flatMap((h, i) => [
    { jsonrpc: '2.0', id: i * 2, method: 'eth_getTransactionByHash', params: [h] },
    { jsonrpc: '2.0', id: i * 2 + 1, method: 'eth_getTransactionReceipt', params: [h] },
  ]);
  const replies = await alchemyCall(batch);
  const byId = new Map((Array.isArray(replies) ? replies : []).map((r) => [r.id, r.result]));
  return hashes.map((h, i) => {
    const tx = byId.get(i * 2) || {};
    const rc = byId.get(i * 2 + 1) || {};
    const t = byHash.get(h);
    const input = tx.input || '0x';
    const ok = rc.status === '0x1';
    return {
      blockNumber: hexToDec(t.blockNum), timeStamp: toSecs(t), hash: h,
      from: tx.from || t.from || '', to: tx.to || t.to || '', value: hexToDec(tx.value || '0x0'), input,
      methodId: input.length >= 10 ? input.slice(0, 10) : '0x', functionName: '',
      isError: rc.status ? (ok ? '0' : '1') : '0', txreceipt_status: rc.status ? (ok ? '1' : '0') : '',
      gasUsed: hexToDec(rc.gasUsed || '0x0'), gasPrice: hexToDec(tx.gasPrice || '0x0'), contractAddress: rc.contractAddress || '',
    };
  });
}

// Etherscan "tokentx": ERC-20 movements in and out of the wallet (USDC, EURC, ...).
async function alchemyTokentx(address, count) {
  const transfers = await bothDirections(address, { category: ['erc20'] }, count);
  return transfers.slice(0, count).map((t) => ({
    blockNumber: hexToDec(t.blockNum), timeStamp: toSecs(t), hash: t.hash, from: t.from || '', to: t.to || '',
    value: hexToDec(t.rawContract?.value || '0x0'), contractAddress: t.rawContract?.address || '',
    tokenSymbol: t.asset || '', tokenDecimal: t.rawContract?.decimal ? hexToDec(t.rawContract.decimal) : '',
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (ratelimit) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const { success } = await ratelimit.limit(ip);
    if (!success) return res.status(429).json({ error: 'Too many explorer requests. Please slow down.' });
  }

  try {
    const query = req.query || {};
    const isMainnet = query.network === 'mainnet';

    const params = new URLSearchParams();
    for (const key of Object.keys(query)) {
      if (key === 'network') continue; // routing flag only, not forwarded
      if (!ALLOWED_PARAMS.has(key)) continue; // drops apikey/chainid overrides and anything unexpected
      const value = Array.isArray(query[key]) ? query[key][0] : query[key];
      if (value !== undefined) params.set(key, String(value).slice(0, 100));
    }
    const mod = params.get('module');
    if (!ALLOWED_ACTIONS[mod]?.has(params.get('action'))) {
      return res.status(400).json({ error: 'Unsupported explorer query.' });
    }
    if (params.has('address') && !/^0x[0-9a-fA-F]{40}$/.test(params.get('address'))) {
      return res.status(400).json({ error: 'Invalid address.' });
    }

    // Cache key includes which network this is, so testnet and mainnet
    // results for the same module/action/address never collide. Built BEFORE
    // the API key is added, so the key never ends up inside a Redis key name.
    params.sort();
    const cacheKey = `${isMainnet ? 'mainnet' : 'testnet'}:${params.toString()}`;

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

    const cached = await getCached(cacheKey);
    if (cached) {
      res.status(cached.status);
      res.setHeader('Content-Type', cached.contentType);
      return res.send(cached.body);
    }

    if (isMainnet && process.env.ALCHEMY_API_KEY && mod === 'account' && ALCHEMY_ACTIONS.has(params.get('action')) && params.has('address')) {
      const count = Math.min(Math.max(parseInt(params.get('offset') || params.get('limit') || '30', 10) || 30, 1), 100);
      const address = params.get('address');
      const result = params.get('action') === 'txlist' ? await alchemyTxlist(address, count) : await alchemyTokentx(address, count);
      const body = JSON.stringify({ status: '1', message: 'OK', result });
      await setCached(cacheKey, { status: 200, contentType: 'application/json', body });
      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      return res.send(body);
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
    // get masked behind a stale error for the rest of the cache window. Etherscan
    // also reports rate limits as HTTP 200 with a "Max rate limit" result, so
    // those are skipped too.
    if (response.status >= 200 && response.status < 300 && !/rate limit/i.test(text.slice(0, 300))) {
      await setCached(cacheKey, { status: response.status, contentType, body: text });
    }

    res.status(response.status);
    res.setHeader('Content-Type', contentType);
    res.send(text);
  } catch (error) {
    console.error('arcscan-proxy error:', error?.message);
    res.status(502).json({ error: 'Explorer unavailable. Please try again.' });
  }
};

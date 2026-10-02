// Proxies JSON-RPC calls to Arc Testnet, and now Arc MAINNET too via an
// opt-in ?network=mainnet query param (default stays testnet, so nothing
// existing changes). Two problems this solves at once, for either network:
//
// 1. Arc's own public RPC doesn't return CORS headers, so calling it
//    directly from a browser fails (confirmed for testnet:
//    circlefin/arc-node#90; confirmed for mainnet 2026-09-18 -- a Node
//    script reading the same address's balance worked instantly while the
//    browser read 0.00 for the same call, the classic CORS signature: it
//    works server-side/Node but silently fails from a page).
// 2. The app was previously calling a *keyed* provider (Alchemy) directly from the
//    browser, with the key hardcoded in client-side source. That key is now
//    server-side only, read from an environment variable never bundled into the
//    frontend.
//
// This is a thin JSON-RPC passthrough — reads and signed-transaction
// broadcasts are both normal, harmless RPC traffic; the actual private key
// never touches this server. It's rate-limited per IP AND restricted to a
// method allowlist below: without either, this was an open relay — anyone
// could point arbitrary RPC traffic (debug_traceTransaction, admin_*, etc.)
// through it and run up whatever quota/cost the underlying provider
// (Alchemy, if ARC_RPC_URL is set) charges, or pull node-internal data
// never meant to be public. eth_getLogs stays allowed — LiquidityPools.tsx
// genuinely uses it for swap history — but debug_*/trace_*/admin_*/
// personal_*/txpool_*/miner_* namespaces, which nothing in this app calls,
// are blocked outright. Same allowlist and rate limit apply to both networks.
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

const ARC_TESTNET_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
// Matches viem's own built-in `arc` chain definition's primary RPC.
const ARC_MAINNET_RPC_URL = process.env.ARC_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io';

const ALLOWED_METHODS = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
  'eth_estimateGas', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt',
  'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex', 'eth_getTransactionReceipt',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber', 'eth_sendRawTransaction', 'eth_getLogs',
  'eth_getFilterChanges', 'eth_getFilterLogs', 'eth_newFilter', 'eth_newBlockFilter',
  'eth_uninstallFilter', 'eth_syncing', 'eth_getUncleCountByBlockHash', 'eth_getUncleCountByBlockNumber',
  'net_version', 'net_listening', 'net_peerCount', 'web3_clientVersion', 'web3_sha3',
]);

// A JSON-RPC batch is one HTTP request but many node calls. Without a cap, a single
// 1000-call batch cost only one rate-limit token. Batches are capped, and every call
// in a batch now counts toward the per-IP limit.
const MAX_BATCH = 64; // LI.FI's SDK batches up to 64 calls per request (sdk-provider-ethereum publicClient.js)
// eth_getLogs over the whole chain with no address is the heaviest query a node serves.
// Every getLogs in this app is scoped to one contract, so address-less queries are refused,
// and explicit numeric ranges are capped.
const MAX_LOG_BLOCK_SPAN = 100000n;

// Block tags ("latest", "earliest"...) used to skip the range check entirely, so fromBlock "earliest"
// + toBlock "latest" (the whole chain) got through. Tags are now resolved to real numbers first;
// the latest block is only fetched when a tag actually needs it.
const LATEST_TAGS = new Set(['latest', 'pending', 'safe', 'finalized']);
async function logsQueryError(call, latestBlock) {
  const f = Array.isArray(call.params) ? call.params[0] : null;
  if (!f || typeof f !== 'object') return 'eth_getLogs needs a filter object.';
  if (f.blockHash) return f.address ? null : 'eth_getLogs must be scoped to a contract address.';
  if (!f.address || (Array.isArray(f.address) && (f.address.length === 0 || f.address.length > 5))) {
    return 'eth_getLogs must be scoped to 1-5 contract addresses.';
  }
  const toNumber = async (v) => {
    if (v === undefined || v === null || LATEST_TAGS.has(v)) return latestBlock();
    if (v === 'earliest') return 0n;
    if (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
    return null;
  };
  const from = await toNumber(f.fromBlock);
  const to = await toNumber(f.toBlock);
  if (from === null || to === null) return 'eth_getLogs fromBlock/toBlock must be a block number or tag.';
  if (to - from > MAX_LOG_BLOCK_SPAN) return `eth_getLogs block range is limited to ${MAX_LOG_BLOCK_SPAN} blocks.`;
  return null;
}

let ratelimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Generous limit, counted per CALL (a batch of 10 costs 10) — a normal
  // session makes many legitimate RPC calls (balance/reserve reads, tx
  // status polling, LI.FI's batched reads). This is a brake on sustained
  // abuse from one IP, not a cap on normal usage.
  ratelimit = new Ratelimit({
    redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }),
    limiter: Ratelimit.slidingWindow(300, '60 s'),
    prefix: 'ratelimit:rpc-proxy',
  });
} else if (process.env.NODE_ENV === 'production') {
  // Hard requirement in production (2026-09-19): this endpoint forwards
  // to a real RPC provider that can be metered/rate-limited on Circle's
  // or Arc's end, and previously just logged a warning and kept serving
  // unprotected requests if Redis wasn't configured -- an easy way to
  // silently ship with zero abuse protection. Local dev without Redis
  // still works (degraded, unprotected) so it's not required to run the
  // app locally, but production refuses to serve without it.
  console.error('api/rpc-proxy.js: UPSTASH_REDIS_REST_URL/TOKEN not set in production — refusing to serve unprotected.');
} else {
  console.warn('api/rpc-proxy.js: UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is OFF (dev only).');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ratelimit && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'Service temporarily unavailable — rate limiting is not configured.' });
  }

  // A JSON-RPC request can be a single object or a batch array — check
  // every method name in either shape before forwarding anything.
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return res.status(400).json({ error: `A batch may contain 1-${MAX_BATCH} calls.` });
  }
  const targetUrl = req.query?.network === 'mainnet' ? ARC_MAINNET_RPC_URL : ARC_TESTNET_RPC_URL;
  // Fetched at most once per request, and only if a getLogs filter uses a "latest"-style tag.
  let latestPromise = null;
  const latestBlock = () => {
    if (!latestPromise) {
      latestPromise = fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })
        .then((r) => r.json())
        .then((d) => BigInt(d.result));
    }
    return latestPromise;
  };

  for (const call of calls) {
    if (!call || typeof call.method !== 'string' || !ALLOWED_METHODS.has(call.method)) {
      return res.status(403).json({ error: `RPC method "${String(call?.method).slice(0, 60)}" is not on the allowlist.` });
    }
  }

  if (ratelimit) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const { success } = await ratelimit.limit(ip, { rate: calls.length });
    if (!success) {
      return res.status(429).json({ error: 'Too many RPC requests — please slow down.' });
    }
  }

  // getLogs range check runs after the rate limit, since resolving a "latest" tag costs an upstream call.
  for (const call of calls) {
    if (call.method !== 'eth_getLogs') continue;
    let why;
    try { why = await logsQueryError(call, latestBlock); } catch { return res.status(502).json({ error: 'RPC upstream unavailable. Please try again.' }); }
    if (why) return res.status(400).json({ error: why });
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    console.error('rpc-proxy upstream error:', error?.message);
    res.status(502).json({ error: 'RPC upstream unavailable. Please try again.' });
  }
};

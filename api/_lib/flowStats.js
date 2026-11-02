// FlowFi's own activity counter (used by api/stats.js).
//
// LI.FI's partner portal only sees volume that went through LI.FI. Swaps routed to KyberSwap/De1,
// native CCTP bridges, Gateway, Earn & Borrow, Send and Batch payment never show up there. This
// counter records every transaction a user signs through FlowFi and verifies each one onchain
// before counting it, so the totals can be shown to partners and backed by real tx hashes.
//
// What is counted for a tx hash:
//   - it exists on a supported chain, succeeded, and was sent by the address the app reported;
//   - it was mined in the last MAX_AGE_SECONDS (stops anyone from backfilling old or foreign txs);
//   - plain ERC-20 approvals are skipped (they move no funds);
//   - volume = the larger of what the sender paid out and what they received, in known Circle
//     tokens (USDC, EURC, cirBTC), read from the token Transfer logs; on Arc, native USDC sent
//     as value counts too. EURC and cirBTC are priced in USD at the moment they are recorded.
//   - each hash is counted once.
const { Redis } = require('@upstash/redis');
const { createPublicClient, http, getAddress, isHash, isAddress } = require('viem');
const chains = require('viem/chains');

const MAX_AGE_SECONDS = Number(process.env.STATS_MAX_AGE_SECONDS) || 30 * 60;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVE_SELECTOR = '0x095ea7b3';
const LOG_KEEP = 20000; // recent verified txs kept for export

// Token addresses below are the same ones FlowFi already uses in its bridge/Gateway/Send code.
const T = (address, symbol, decimals) => ({ address: address.toLowerCase(), symbol, decimals });
const CHAINS = {
  5042: { chain: chains.arc, rpcEnv: 'ARC_MAINNET_RPC_URL', tokens: [
    T('0x3600000000000000000000000000000000000000', 'USDC', 6),
    T('0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', 'EURC', 6),
    T('0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', 'cirBTC', 8),
  ], nativeIsUsdc: true },
  1: { chain: chains.mainnet, rpcEnv: 'ETHEREUM_RPC_URL', tokens: [
    T('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 6),
    T('0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', 'EURC', 6),
  ] },
  8453: { chain: chains.base, rpcEnv: 'BASE_RPC_URL', tokens: [
    T('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 6),
    T('0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 'EURC', 6),
  ] },
  42161: { chain: chains.arbitrum, rpcEnv: 'ARBITRUM_RPC_URL', tokens: [
    T('0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 6),
  ] },
  43114: { chain: chains.avalanche, rpcEnv: 'AVALANCHE_RPC_URL', tokens: [
    T('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USDC', 6),
    T('0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD', 'EURC', 6),
  ] },
  480: { chain: chains.worldchain, rpcEnv: 'WORLDCHAIN_RPC_URL', tokens: [
    T('0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', 'USDC', 6),
  ] },
};

const clients = new Map();
let makeClient = (c, url) => createPublicClient({ chain: c.chain, transport: http(url, { timeout: 8000 }) });
function clientFor(chainId) {
  if (!clients.has(chainId)) {
    const c = CHAINS[chainId];
    const url = process.env[c.rpcEnv] || c.chain.rpcUrls.default.http[0];
    clients.set(chainId, makeClient(c, url));
  }
  return clients.get(chainId);
}

// ---------- storage: Upstash Redis in production, in-memory for local `npm run dev` ----------
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

const mem = { kv: new Map(), hashes: new Map(), sets: new Map(), lists: new Map() };
const store = {
  available: () => !!redis || !isProd,
  async setNx(key, val, ttl) {
    if (redis) return (await redis.set(key, val, { nx: true, ex: ttl })) === 'OK';
    if (mem.kv.has(key)) return false; mem.kv.set(key, val); return true;
  },
  async get(key) { return redis ? redis.get(key) : (mem.kv.get(key) ?? null); },
  async set(key, val, ttl) { if (redis) return redis.set(key, val, { ex: ttl }); mem.kv.set(key, val); },
  async hincr(key, field, by) {
    if (redis) return redis.hincrby(key, field, by);
    const h = mem.hashes.get(key) ?? {}; h[field] = (h[field] ?? 0) + by; mem.hashes.set(key, h);
  },
  async hgetall(key) { return redis ? ((await redis.hgetall(key)) ?? {}) : (mem.hashes.get(key) ?? {}); },
  async sadd(key, v) {
    if (redis) return redis.sadd(key, v);
    const s = mem.sets.get(key) ?? new Set(); s.add(v); mem.sets.set(key, s);
  },
  async scard(key) { return redis ? redis.scard(key) : (mem.sets.get(key)?.size ?? 0); },
  async lpush(key, v, keep) {
    if (redis) { await redis.lpush(key, v); await redis.ltrim(key, 0, keep - 1); return; }
    const l = mem.lists.get(key) ?? []; l.unshift(v); mem.lists.set(key, l.slice(0, keep));
  },
  async lrange(key, a, b) { return redis ? redis.lrange(key, a, b) : (mem.lists.get(key) ?? []).slice(a, b + 1); },
};

// ---------- prices (EURC, cirBTC) ----------
async function prices() {
  const cached = await store.get('stats:prices');
  if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=euro-coin,bitcoin&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const p = { EURC: Number(d?.['euro-coin']?.usd) || null, cirBTC: Number(d?.bitcoin?.usd) || null };
    if (p.EURC || p.cirBTC) await store.set('stats:prices', JSON.stringify(p), 600);
    return p;
  } catch {
    return { EURC: null, cirBTC: null };
  }
}

function toUsd(symbol, raw, decimals, px) {
  const amount = Number(raw) / 10 ** decimals;
  if (symbol === 'USDC') return amount;
  const p = px[symbol];
  return p ? amount * p : 0;
}

// ---------- verification ----------
async function verify({ hash, chainId, from }) {
  const cfg = CHAINS[chainId];
  if (!cfg) return { status: 'rejected', reason: 'unsupported chain' };
  const client = clientFor(chainId);

  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch { return { status: 'pending' }; } // not mined yet (or RPC hiccup): the client retries

  if (receipt.status !== 'success') return { status: 'rejected', reason: 'reverted' };
  const sender = getAddress(receipt.from);
  if (sender !== getAddress(from)) return { status: 'rejected', reason: 'sender mismatch' };

  const [tx, block] = await Promise.all([
    client.getTransaction({ hash }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  const age = Math.floor(Date.now() / 1000) - Number(block.timestamp);
  if (age > MAX_AGE_SECONDS) return { status: 'rejected', reason: 'too old' };
  if ((tx.input || '').slice(0, 10).toLowerCase() === APPROVE_SELECTOR) return { status: 'rejected', reason: 'approval' };

  const px = await prices();
  const me = sender.toLowerCase();
  let out = 0, inn = 0;
  for (const log of receipt.logs) {
    if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const tok = cfg.tokens.find((t) => t.address === log.address.toLowerCase());
    if (!tok) continue;
    const src = '0x' + log.topics[1].slice(26);
    const dst = '0x' + log.topics[2].slice(26);
    const usd = toUsd(tok.symbol, BigInt(log.data), tok.decimals, px);
    if (src === me) out += usd;
    if (dst === me) inn += usd;
  }
  if (cfg.nativeIsUsdc && tx.value > 0n) out = Math.max(out, Number(tx.value) / 1e18);

  return {
    status: 'ok',
    record: {
      h: hash, c: chainId, f: me,
      to: tx.to ? tx.to.toLowerCase() : null,
      v: Math.round(Math.max(out, inn) * 100) / 100,
      t: Number(block.timestamp),
    },
  };
}

async function save(r, source) {
  const day = new Date(r.t * 1000).toISOString().slice(0, 10);
  const cents = Math.round(r.v * 100);
  await Promise.all([
    store.hincr('stats:totals', 'txs', 1),
    store.hincr('stats:totals', 'volumeCents', cents),
    store.hincr('stats:chains', String(r.c), 1),
    store.hincr('stats:sources', source, 1),
    store.hincr(`stats:day:${day}`, 'txs', 1),
    store.hincr(`stats:day:${day}`, 'volumeCents', cents),
    store.sadd('stats:wallets', r.f),
    store.sadd(`stats:daywallets:${day}`, r.f),
    store.lpush('stats:log', JSON.stringify({ ...r, s: source }), LOG_KEEP),
  ]);
  const first = await store.get('stats:since');
  if (!first) await store.set('stats:since', String(r.t), 60 * 60 * 24 * 3650);
}

async function track(body) {
  const hash = String(body?.hash ?? '');
  const chainId = Number(body?.chainId);
  const from = String(body?.from ?? '');
  const source = ['wallet', 'lifi'].includes(body?.source) ? body.source : 'wallet';
  if (!isHash(hash) || !isAddress(from) || !Number.isInteger(chainId)) return { status: 'rejected', reason: 'bad input' };

  const seenKey = `stats:seen:${chainId}:${hash.toLowerCase()}`;
  if (await store.get(seenKey)) return { status: 'duplicate' };

  const result = await verify({ hash, chainId, from });
  if (result.status !== 'ok') return result;

  // Claim the hash only after it verified, so a "pending" attempt can be retried.
  if (!(await store.setNx(seenKey, '1', 60 * 60 * 24 * 400))) return { status: 'duplicate' };
  await save(result.record, source);
  return { status: 'recorded', volumeUsd: result.record.v };
}

function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  return out;
}

async function summary({ days = 30 } = {}) {
  const [totals, byChain, bySource, wallets, since] = await Promise.all([
    store.hgetall('stats:totals'), store.hgetall('stats:chains'), store.hgetall('stats:sources'),
    store.scard('stats:wallets'), store.get('stats:since'),
  ]);
  const daily = await Promise.all(lastDays(days).map(async (d) => {
    const [h, w] = await Promise.all([store.hgetall(`stats:day:${d}`), store.scard(`stats:daywallets:${d}`)]);
    return { date: d, txs: Number(h?.txs ?? 0), volumeUsd: Number(h?.volumeCents ?? 0) / 100, wallets: Number(w ?? 0) };
  }));
  const num = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, Number(v)]));
  return {
    since: since ? new Date(Number(since) * 1000).toISOString() : null,
    transactions: Number(totals?.txs ?? 0),
    volumeUsd: Number(totals?.volumeCents ?? 0) / 100,
    uniqueWallets: Number(wallets ?? 0),
    byChain: num(byChain),
    bySource: num(bySource),
    daily,
    note: 'Every transaction is verified onchain before it is counted. Approvals are excluded.',
  };
}

async function exportLog(limit) {
  const rows = await store.lrange('stats:log', 0, Math.max(0, Math.min(limit, LOG_KEEP) - 1));
  return rows.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

// Test hook only: swap the RPC client for a stub.
function __setClientFactory(f) { makeClient = f; clients.clear(); }

module.exports = { __setClientFactory, track, summary, exportLog, store, redis, isProd, clientIp, SUPPORTED_CHAIN_IDS: Object.keys(CHAINS).map(Number) };

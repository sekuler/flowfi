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
//   - any other token the sender paid or received (e.g. ETH sent with Send) is priced with LI.FI's
//     token price for that chain; a token LI.FI has no price for adds 0.
//   - each hash is counted once.
//
// LI.FI routes (Any swap / Any bridge) are measured differently, because they can start on any
// chain (Solana, Sui, Bitcoin, Robinhood Chain, ...) and in any token:
//   - the USD amount comes from LI.FI's own records for that tx (status DONE, integrator = ours);
//   - besides what the app reports, sync() pulls every transfer of our integrator from LI.FI's
//     analytics API, so a route still counts when the user closes the tab before it finishes.
// Per-wallet totals (volume + tx count) are kept too, for points/leaderboards.
const { Redis } = require('@upstash/redis');
const { createPublicClient, http, getAddress, isHash, isAddress } = require('viem');
const chains = require('viem/chains');

const MAX_AGE_SECONDS = Number(process.env.STATS_MAX_AGE_SECONDS) || 30 * 60;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVE_SELECTOR = '0x095ea7b3';
const LOG_KEEP = 20000; // recent verified txs kept for export

// ---------- LI.FI ----------
const LIFI_API = 'https://li.quest';
const LIFI_INTEGRATOR = process.env.LIFI_INTEGRATOR || 'flowfi'; // same id the widget is configured with
const LIFI_FROM = Number(process.env.STATS_LIFI_FROM) || Date.UTC(2026, 8, 16) / 1000; // Arc mainnet launch
const LIFI_WINDOW = 30 * 86400;  // analytics are read in 30-day windows
const LIFI_OVERLAP = 86400;      // re-read the last day, to catch transfers that finished late
const LIFI_PAGE = 50;
let lifiFetch = async (path) => {
  const key = process.env.LIFI_API_KEY || process.env.VITE_LIFI_API_KEY;
  const r = await fetch(LIFI_API + path, { headers: key ? { 'x-lifi-api-key': key } : {}, signal: AbortSignal.timeout(6000) });
  let json = null;
  try { json = await r.json(); } catch { /* empty or non-JSON body */ }
  return { ok: r.ok, status: r.status, json };
};

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
const memGet = (key) => {
  const e = mem.kv.get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) { mem.kv.delete(key); return null; }
  return e.val;
};
const memSet = (key, val, ttl) => mem.kv.set(key, { val, exp: ttl ? Date.now() + ttl * 1000 : 0 });
const store = {
  available: () => !!redis || !isProd,
  async setNx(key, val, ttl) {
    if (redis) return (await redis.set(key, val, { nx: true, ex: ttl })) === 'OK';
    if (memGet(key) !== null) return false; memSet(key, val, ttl); return true;
  },
  async get(key) { return redis ? redis.get(key) : memGet(key); },
  async set(key, val, ttl) { if (redis) return redis.set(key, val, { ex: ttl }); memSet(key, val, ttl); },
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

// USD price + decimals of any other token, from LI.FI's token list (cached 10 minutes; a token
// LI.FI doesn't know is cached as unknown so it isn't asked again on every tx).
const NATIVE = '0x0000000000000000000000000000000000000000';
const MAX_OTHER_TOKENS = 6; // per tx
async function lifiTokenPrice(chainId, address) {
  const key = `stats:px:${chainId}:${address}`;
  const cached = await store.get(key);
  if (cached) { const c = typeof cached === 'string' ? JSON.parse(cached) : cached; return c.p ? c : null; }
  let r;
  try { r = await lifiFetch(`/v1/token?chain=${encodeURIComponent(chainId)}&token=${encodeURIComponent(address)}`); }
  catch { return null; }
  if (r.status === 404) { await store.set(key, JSON.stringify({ p: 0 }), 600); return null; }
  if (!r.ok || !r.json) return null;
  const t = Array.isArray(r.json) ? r.json[0] : r.json;
  const p = Number(t?.priceUSD);
  const d = Number(t?.decimals);
  const found = Number.isFinite(p) && p > 0 && Number.isInteger(d) && d >= 0 && d <= 36;
  await store.set(key, JSON.stringify(found ? { p, d } : { p: 0 }), 600);
  return found ? { p, d } : null;
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
  const other = new Map(); // token address -> { out, inn } raw amounts, for tokens priced via LI.FI
  for (const log of receipt.logs) {
    // ERC-20 Transfer only: 3 topics + a 32-byte amount (an NFT transfer has 4 topics).
    if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length !== 3 || !/^0x[0-9a-fA-F]{64}$/.test(log.data || '')) continue;
    const src = '0x' + log.topics[1].slice(26);
    const dst = '0x' + log.topics[2].slice(26);
    if (src !== me && dst !== me) continue;
    const addr = log.address.toLowerCase();
    const raw = BigInt(log.data);
    const tok = cfg.tokens.find((t) => t.address === addr);
    if (!tok) {
      const o = other.get(addr) ?? { out: 0n, inn: 0n };
      if (src === me) o.out += raw;
      if (dst === me) o.inn += raw;
      other.set(addr, o);
      continue;
    }
    const usd = toUsd(tok.symbol, raw, tok.decimals, px);
    if (src === me) out += usd;
    if (dst === me) inn += usd;
  }
  if (cfg.nativeIsUsdc && tx.value > 0n) out = Math.max(out, Number(tx.value) / 1e18);
  else if (tx.value > 0n) other.set(NATIVE, { out: tx.value, inn: 0n }); // native coin sent (ETH, AVAX, ...)
  for (const [addr, o] of [...other].slice(0, MAX_OTHER_TOKENS)) {
    const t = await lifiTokenPrice(chainId, addr);
    if (!t) continue;
    out += (Number(o.out) / 10 ** t.d) * t.p;
    inn += (Number(o.inn) / 10 ** t.d) * t.p;
  }

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
    store.hincr('stats:walletvol', r.f, cents),
    store.hincr('stats:wallettx', r.f, 1),
    store.lpush('stats:log', JSON.stringify({ ...r, s: source, w: 1 }), LOG_KEEP), // w: already in the per-wallet totals
  ]);
  const first = await store.get('stats:since');
  if (!first) await store.set('stats:since', String(r.t), 60 * 60 * 24 * 3650);
}

// ---------- LI.FI verification ----------
const isHex = (v) => /^0x/i.test(v);
const norm = (v) => (isHex(v) ? v.toLowerCase() : v); // EVM/Sui are hex; Solana/Bitcoin are case-sensitive
const seenKeyFor = (chainId, hash) => `stats:seen:${chainId}:${norm(hash)}`;

function lifiUsd(side) {
  const direct = Number(side?.amountUSD);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const px = Number(side?.token?.priceUSD);
  const dec = Number(side?.token?.decimals);
  if (!side?.amount || !Number.isFinite(px) || !Number.isInteger(dec)) return 0;
  return (Number(side.amount) / 10 ** dec) * px;
}

// Turns one LI.FI transfer (from /v1/status or /v2/analytics/transfers) into a record, or null if
// it isn't a finished transfer of ours.
function lifiRecord(t) {
  if (t?.status !== 'DONE' || t.substatus === 'REFUNDED') return null;
  if (t.metadata?.integrator !== LIFI_INTEGRATOR) return null;
  const s = t.sending;
  if (!s?.txHash || !Number.isInteger(Number(s.chainId)) || !t.fromAddress) return null;
  let ts = Number(s.timestamp) || Math.floor(Date.now() / 1000);
  if (ts > 1e12) ts = Math.floor(ts / 1000); // milliseconds
  const usd = lifiUsd(s) || lifiUsd(t.receiving);
  return {
    h: norm(String(s.txHash)), c: Number(s.chainId), f: norm(String(t.fromAddress)),
    to: null, v: Math.round(usd * 100) / 100, t: ts, tool: t.tool || null,
  };
}

// { state: 'done', record } | 'pending' | 'failed' | 'none' (LI.FI doesn't know it / not ours) | 'error'
async function lifiStatus(hash, chainId) {
  let r;
  try { r = await lifiFetch(`/v1/status?txHash=${encodeURIComponent(hash)}&fromChain=${encodeURIComponent(chainId)}`); }
  catch { return { state: 'error' }; }
  if (r.status === 404) return { state: 'none' };
  if (!r.ok || !r.json) return { state: 'error' };
  const st = r.json.status;
  if (st === 'PENDING') return { state: 'pending' };
  if (st === 'FAILED') return { state: 'failed' };
  if (st !== 'DONE') return { state: 'none' };
  if (r.json.substatus === 'REFUNDED') return { state: 'failed' };
  const record = lifiRecord(r.json);
  return record ? { state: 'done', record } : { state: 'none' };
}

async function claimAndSave(record, source) {
  if (!(await store.setNx(seenKeyFor(record.c, record.h), '1', 60 * 60 * 24 * 400))) return { status: 'duplicate' };
  await save(record, source);
  return { status: 'recorded', volumeUsd: record.v };
}

async function track(body) {
  const hash = String(body?.hash ?? '');
  const chainId = Number(body?.chainId);
  const from = String(body?.from ?? '');
  const source = ['wallet', 'lifi'].includes(body?.source) ? body.source : 'wallet';
  const evm = isHash(hash) && isAddress(from);
  // LI.FI routes may start on Solana, Sui or Bitcoin, where hashes and addresses look different.
  const lifiShape = /^[0-9a-zA-Z]{32,128}$/.test(hash) && /^[0-9a-zA-Z]{25,128}$/.test(from);
  if (!Number.isInteger(chainId) || chainId <= 0 || !(source === 'lifi' ? lifiShape : evm)) return { status: 'rejected', reason: 'bad input' };

  if (await store.get(seenKeyFor(chainId, hash))) return { status: 'duplicate' };

  if (source === 'lifi') {
    const ls = await lifiStatus(hash, chainId);
    if (ls.state === 'done') {
      if (ls.record.f !== norm(from)) return { status: 'rejected', reason: 'sender mismatch' };
      return claimAndSave(ls.record, 'lifi');
    }
    if (ls.state === 'pending') return { status: 'pending' };
    if (ls.state === 'failed') return { status: 'rejected', reason: 'failed or refunded' };
    // LI.FI doesn't know the tx (yet) or couldn't be reached: verify onchain where we can,
    // otherwise leave it to sync(), which reads LI.FI's own list of our transfers.
    if (!evm || !CHAINS[chainId]) return { status: 'pending' };
  }

  const result = await verify({ hash, chainId, from });
  if (result.status !== 'ok') return result;

  // No Circle token moved for the sender: if this tx is one of our LI.FI routes (any other token),
  // take the USD amount from LI.FI instead of recording 0.
  if (result.record.v === 0) {
    const ls = await lifiStatus(hash, chainId);
    if (ls.state === 'done' && ls.record.f === result.record.f) return claimAndSave(ls.record, 'lifi');
    if (ls.state === 'pending') return { status: 'pending' };
    if (ls.state === 'failed') return { status: 'rejected', reason: 'failed or refunded' };
  }

  // Claim the hash only after it verified, so a "pending" attempt can be retried.
  return claimAndSave(result.record, source);
}

// Pulls every finished transfer of our integrator from LI.FI's analytics API and counts the ones
// not counted yet. Resumable (window + cursor are stored), so one call never has to do it all.
async function sync({ budgetMs = 6000, force = false } = {}) {
  if (!force && !(await store.setNx('stats:lifi:throttle', '1', 60))) return { ok: true, skipped: true, added: 0 };
  const started = Date.now();
  const raw = await store.get('stats:lifi:sync');
  let state = (typeof raw === 'string' ? JSON.parse(raw) : raw) || { from: LIFI_FROM, to: null, next: null };
  let added = 0;
  let ok = true;
  let caughtUp = false;
  while (Date.now() - started < budgetMs) {
    const now = Math.floor(Date.now() / 1000);
    if (!state.to) state.to = Math.min(state.from + LIFI_WINDOW, now);
    const q = new URLSearchParams({
      integrator: LIFI_INTEGRATOR, status: 'DONE',
      fromTimestamp: String(state.from), toTimestamp: String(state.to), limit: String(LIFI_PAGE),
    });
    if (state.next) q.set('next', state.next);
    let r;
    try { r = await lifiFetch(`/v2/analytics/transfers?${q}`); } catch { ok = false; break; }
    if (!r.ok || !Array.isArray(r.json?.data)) { ok = false; break; }
    for (const t of r.json.data) {
      const record = lifiRecord(t);
      if (!record) continue;
      if ((await claimAndSave(record, 'lifi')).status === 'recorded') added++;
    }
    if (r.json.hasNext && r.json.next) {
      state.next = r.json.next;
    } else {
      caughtUp = state.to >= now - 60;
      state = { from: Math.max(LIFI_FROM, state.to - LIFI_OVERLAP), to: null, next: null };
    }
    await store.set('stats:lifi:sync', JSON.stringify(state), 60 * 60 * 24 * 3650);
    if (caughtUp) break;
  }
  return { ok, added, caughtUp };
}

// ---------- per-wallet totals ----------
// Txs recorded before per-wallet totals existed are replayed once from the log.
async function ensureWalletTotals() {
  if (!(await store.setNx('stats:walletvol:built', '1', 60 * 60 * 24 * 3650))) return;
  const rows = await exportLog(LOG_KEEP);
  const vol = new Map(); const txs = new Map();
  for (const r of rows) {
    if (r.w || !r.f) continue;
    vol.set(r.f, (vol.get(r.f) ?? 0) + Math.round((Number(r.v) || 0) * 100));
    txs.set(r.f, (txs.get(r.f) ?? 0) + 1);
  }
  for (const [f, cents] of vol) {
    await Promise.all([store.hincr('stats:walletvol', f, cents), store.hincr('stats:wallettx', f, txs.get(f))]);
  }
}

async function wallets({ wallet } = {}) {
  await ensureWalletTotals();
  const [vol, txs] = await Promise.all([store.hgetall('stats:walletvol'), store.hgetall('stats:wallettx')]);
  const list = Object.entries(vol ?? {})
    .map(([w, cents]) => ({ wallet: w, volumeUsd: Number(cents) / 100, transactions: Number(txs?.[w] ?? 0) }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
  if (wallet) {
    const w = norm(String(wallet));
    return list.find((x) => x.wallet === w) ?? { wallet: w, volumeUsd: 0, transactions: 0 };
  }
  return { count: list.length, wallets: list };
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
    note: 'Every transaction is verified onchain, or against LI.FI\'s records for LI.FI routes, before it is counted. Approvals are excluded.',
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

// Test hook only: swap the LI.FI HTTP call for a stub.
function __setLifiFetch(f) { lifiFetch = f; }

module.exports = { __setClientFactory, __setLifiFetch, track, sync, wallets, summary, exportLog, store, redis, isProd, clientIp, SUPPORTED_CHAIN_IDS: Object.keys(CHAINS).map(Number) };

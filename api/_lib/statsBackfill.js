// History scan for the time before the counter existed.
//
// The counter only started on COUNTER_START. For the weeks before it, nothing recorded which txs
// were made through FlowFi, so this reads the chain instead:
//   1. take every wallet we know used FlowFi (LI.FI's records of our routes + the counter itself);
//   2. list each wallet's own transactions between Arc mainnet launch and COUNTER_START;
//   3. keep the ones sent to a contract FlowFi's screens use (see TARGETS), and count them with
//      the same onchain verification as live txs.
// What this cannot know: whether such a tx was signed on flowfi.finance or on another app that
// uses the same contract. So the result is reported separately ("backfill") as computed from the
// chain, and plain wallet-to-wallet sends are left out (they look like any other transfer).
//
// It runs in small steps (a few seconds per stats read) and remembers where it stopped.
const { store, verify, claimAndSave, CHAINS, LIFI_FROM } = require('./flowStats');

const COUNTER_START = Number(process.env.STATS_COUNTER_START) || Date.UTC(2026, 10, 2, 14, 32, 45) / 1000;
const ARC = 5042;
const ARC_DOMAIN = 26; // CCTP domain of Arc
const TOKEN_MESSENGER = '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d'; // CCTP V2, same address on every EVM chain
// Arc contracts FlowFi's screens send to (same addresses as in src/components) -> stats feature.
const TARGETS = {
  [TOKEN_MESSENGER]: 'native',                                   // bridge out of Arc
  '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee': 'gateway',        // Gateway wallet
  '0x34cd04070dd72b14e241112f6d83812df5af7fcd': 'earn-borrow',    // Morpho
  '0x8e357432cc12ff425c36432f312968aeb16112af': 'earn-borrow',    // Galaxy USDC vault
  '0x5befab92a5a3d60f578cb51eeb4e4fd50a1e3123': 'earn-borrow',    // Keyrock Prime USDC vault
  '0x7610094b846657dcf166d59e42973db52c7015f9': 'earn-borrow',    // Bitwise vault
  '0xbeef00be37bde921bae06fad223125bab16c41d1': 'earn-borrow',    // Steakhouse Prime EURC vault
  '0x05863f54b05e96092069ef30c9ca6060336e50b9': 'earn-borrow',    // Gauntlet EURC Prime vault
  '0xb843bdc3a87a05e77e07df9fe48928b3a34b134d': 'earn-borrow',    // Aave main spoke
  '0x4164ebcaf74670aa74c8d4f59de6157c0780f1bb': 'earn-borrow',    // Aave forex spoke
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5': 'swap-best',      // KyberSwap router
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64': 'swap-best',      // De1 router
  '0xe1aec7af5da3b981a8e627ffadc9b980c499b761': 'batch-send',     // FlowFiMultiSend
};
const SOURCE_CHAINS = Object.keys(CHAINS).map(Number).filter((id) => id !== ARC); // bridges into Arc start here

let explorer = async (chainId, address) => {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return { error: 'ETHERSCAN_API_KEY is not set' };
  const q = new URLSearchParams({ chainid: String(chainId), module: 'account', action: 'txlist', address, startblock: '0', endblock: '999999999', page: '1', offset: '1000', sort: 'asc', apikey: key });
  const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(4000) });
  const d = await r.json().catch(() => null);
  if (Array.isArray(d?.result)) return { txs: d.result };
  const msg = String(d?.result || d?.message || `HTTP ${r.status}`);
  if (/no transactions found/i.test(String(d?.message)) || /no transactions found/i.test(msg)) return { txs: [] };
  return { error: msg.slice(0, 160), rateLimited: /rate limit/i.test(msg) };
};

// Which of a wallet's txs on one chain are candidates, and under which feature.
function candidates(chainId, txs) {
  const out = [];
  for (const t of txs) {
    const ts = Number(t.timeStamp);
    if (!(ts >= LIFI_FROM && ts < COUNTER_START) || t.isError === '1' || !t.to || !/^0x[0-9a-f]{64}$/i.test(String(t.hash))) continue;
    const to = String(t.to).toLowerCase();
    if (chainId === ARC) {
      if (TARGETS[to]) out.push({ hash: t.hash, feature: TARGETS[to] });
    } else if (to === TOKEN_MESSENGER) {
      // depositForBurn(amount, destinationDomain, ...): only burns headed to Arc.
      const input = String(t.input || '');
      if (input.length >= 10 + 128 && parseInt(input.slice(10 + 64, 10 + 128), 16) === ARC_DOMAIN) out.push({ hash: t.hash, feature: 'native' });
    }
  }
  return out;
}

const STATE = 'stats:backfill:state';
const TEN_YEARS = 60 * 60 * 24 * 3650;
async function load() { const raw = await store.get(STATE); return (typeof raw === 'string' ? JSON.parse(raw) : raw) || null; }

async function status() {
  const [s, tot] = await Promise.all([load(), store.hgetall('stats:backfill')]);
  return {
    started: !!s, done: !!s?.done, step: s ? s.i : 0, steps: s ? s.queue.length : 0,
    transactions: Number(tot?.txs ?? 0), volumeUsd: Number(tot?.cents ?? 0) / 100,
    until: new Date(COUNTER_START * 1000).toISOString(), unreadable: s?.errors ?? {},
  };
}

// One slice of work. deadline: Date.now() value to stop at.
async function step(deadline) {
  let s = await load();
  if (!s) {
    if (!(await store.get('stats:lifi:caught'))) return status(); // wait for LI.FI's full list first
    const wallets = (await store.smembers('stats:wallets')).filter((w) => /^0x[0-9a-f]{40}$/.test(String(w)));
    const queue = [];
    for (const w of wallets) for (const c of [ARC, ...SOURCE_CHAINS]) queue.push([w, c]);
    s = { queue, i: 0, j: 0, errors: {}, done: queue.length === 0 };
    await store.set(STATE, JSON.stringify(s), TEN_YEARS);
  }
  while (!s.done && Date.now() < deadline) {
    const [wallet, chainId] = s.queue[s.i];
    if (!s.errors[chainId]) {
      const r = await explorer(chainId, wallet).catch((e) => ({ error: String(e?.message || e).slice(0, 160), rateLimited: true }));
      if (r.rateLimited) break;                         // try this same step again on the next read
      if (r.error) { s.errors[chainId] = r.error; }     // this chain can't be read with our key: skip it
      else {
        const list = candidates(chainId, r.txs);
        let paused = false;
        for (; s.j < list.length; s.j++) {
          if (Date.now() >= deadline) { paused = true; break; }
          const c = list[s.j];
          const v = await verify({ hash: c.hash, chainId, feature: c.feature, manual: true }).catch(() => ({ status: 'pending' }));
          if (v.status === 'pending') { paused = true; break; } // RPC hiccup or price missing: retry later
          if (v.status !== 'ok') continue;                      // approval, mint leg, reverted
          if ((await claimAndSave(v.record, 'backfill')).status === 'recorded') {
            await Promise.all([store.hincr('stats:backfill', 'txs', 1), store.hincr('stats:backfill', 'cents', Math.round(v.record.v * 100))]);
          }
        }
        if (paused) { await store.set(STATE, JSON.stringify(s), TEN_YEARS); break; }
      }
    }
    s.i++; s.j = 0;
    if (s.i >= s.queue.length) s.done = true;
    await store.set(STATE, JSON.stringify(s), TEN_YEARS);
  }
  return status();
}

// Test hook only.
function __setExplorer(f) { explorer = f; }

module.exports = { step, status, __setExplorer, COUNTER_START };

// FlowFi activity log — records wallets that completed a real transaction through FlowFi.
// Used for the early-user badge (first 300) and for FlowFi's own volume stats.
//
// POST { kind, chainId, txHash, address }  -> verifies the tx onchain, then records it.
//   kind "lifi": verified through LI.FI's status API (integrator must be "flowfi"); chainId/address optional.
//   other kinds: tx must exist, have succeeded, come from `address`, and go to a contract FlowFi itself uses
//   for that kind (list below). The client never decides what counts — the server checks the chain.
// GET ?address=0x...  -> { eligible, source }  — has this wallet used FlowFi?
//   Looks at our own records first, then at LI.FI transfers tagged "flowfi" since mainnet launch.
//
// Stored (Upstash Redis, same instance as the other endpoints): wallet address, tx hash, chain, kind, time.
// All of it is already public onchain. Nothing else about the user is kept.
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');
const viemChains = require('viem/chains');

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '60 s'), prefix: 'ratelimit:activity' })
  : null;

const ARC_CHAIN_ID = 5042;
const ARC_MAINNET_RPC_URL = process.env.ARC_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io';
const LIFI_API = 'https://li.quest';
const INTEGRATOR = 'flowfi';
const MAINNET_LAUNCH_TS = 1789516800; // 2026-09-16 00:00 UTC — LI.FI lookups start here

const lc = (a) => a.toLowerCase();
// Contracts each kind's main transaction goes to. Mirrors the addresses in src/components — keep in sync.
// null chain list = any chain (the same contract address is deployed on every chain FlowFi uses it on).
const TARGETS = {
  // Native USDC bridge (NativeCctpBridge.tsx): depositForBurn(WithHook) on the source chain
  cctp: { chains: null, to: ['0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'] },
  // EURC / cirBTC bridge (NativeEurcBridge.tsx): crossChainTransfer on the source chain
  cctpx: { chains: null, to: ['0x431871229103b780868f8C6BB820cd16ECf942BC'] },
  // Best-price swap on Arc (BestPriceSwap.tsx): KyberSwap and De¹ routers
  swap: { chains: [ARC_CHAIN_ID], to: ['0x6131b5fae19ea4f9d964eac0408e4408b66337b5', '0x6352a56caadc4f1e25cd6c75970fa768a3304e64'] },
  // Earn (morpho.ts VAULTS): Morpho vaults + Aave V4 Main Spoke
  earn: {
    chains: [ARC_CHAIN_ID],
    to: [
      '0x8E357432CC12ff425c36432F312968aEb16112AF', '0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123',
      '0x7610094B846657dCF166D59e42973db52c7015F9', '0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d',
      '0xbeef00be37BdE921BAE06fad223125BAB16c41D1', '0x05863F54B05e96092069eF30c9Ca6060336e50B9',
    ],
  },
  // Borrow (morpho.ts): Morpho Blue core
  borrow: { chains: [ARC_CHAIN_ID], to: ['0x34CD04070dD72b14E241112F6d83812Df5Af7fCD'] },
  // Gateway deposit (GatewayMainnet.tsx)
  gateway: { chains: null, to: ['0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE'] },
};
for (const k of Object.keys(TARGETS)) TARGETS[k].to = TARGETS[k].to.map(lc);

const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const isTxHash = (h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);

function rpcUrlFor(chainId) {
  if (chainId === ARC_CHAIN_ID) return ARC_MAINNET_RPC_URL;
  const chain = Object.values(viemChains).find((c) => c && c.id === chainId && !c.testnet);
  return chain?.rpcUrls?.default?.http?.[0] || null;
}

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'RPC error');
  return d.result;
}

// Returns the wallet that made the tx if it qualifies, otherwise an error string.
async function verifyEvm(kind, chainId, txHash, address) {
  const target = TARGETS[kind];
  if (target.chains && !target.chains.includes(chainId)) return { error: 'This transaction type is not expected on that chain.' };
  const url = rpcUrlFor(chainId);
  if (!url) return { error: 'Unsupported chain.' };
  const [tx, receipt] = await Promise.all([
    rpc(url, 'eth_getTransactionByHash', [txHash]),
    rpc(url, 'eth_getTransactionReceipt', [txHash]),
  ]);
  if (!tx || !receipt) return { error: 'Transaction not found yet.' };
  if (receipt.status !== '0x1') return { error: 'Transaction did not succeed.' };
  if (!tx.from || lc(tx.from) !== lc(address)) return { error: 'Transaction was not sent by this wallet.' };
  if (!tx.to || !target.to.includes(lc(tx.to))) return { error: 'Transaction did not go through a FlowFi route.' };
  return { wallet: lc(address) };
}

async function verifyLifi(txHash) {
  const r = await fetch(`${LIFI_API}/v1/status?txHash=${txHash}`);
  if (!r.ok) return { error: 'Transfer not found yet.' };
  const s = await r.json();
  if (s?.metadata?.integrator !== INTEGRATOR) return { error: 'Transfer was not made through FlowFi.' };
  if (s.status !== 'DONE') return { error: 'Transfer is not complete yet.' };
  if (!isAddress(s.fromAddress)) return { error: 'Transfer has no EVM sender.' }; // Solana/Bitcoin senders can't hold an Arc badge
  return { wallet: lc(s.fromAddress), chainId: s.sending?.chainId ?? null };
}

async function lifiHasTransfer(address) {
  const q = new URLSearchParams({ integrator: INTEGRATOR, wallet: address, status: 'DONE', fromTimestamp: String(MAINNET_LAUNCH_TS), limit: '1' });
  const r = await fetch(`${LIFI_API}/v2/analytics/transfers?${q}`);
  if (!r.ok) return false;
  const d = await r.json();
  return (d?.data?.length ?? d?.transfers?.length ?? 0) > 0;
}

module.exports = async function handler(req, res) {
  if (!redis) return res.status(503).json({ error: 'Activity log is not configured.' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const { success } = await ratelimit.limit(ip);
  if (!success) return res.status(429).json({ error: 'Too many requests — please slow down.' });

  try {
    if (req.method === 'GET') {
      const address = req.query?.address;
      if (!isAddress(address)) return res.status(400).json({ error: 'A valid address is required.' });
      if (await redis.sismember('activity:wallets', lc(address))) return res.status(200).json({ eligible: true, source: 'flowfi' });
      if (await lifiHasTransfer(address)) {
        await redis.sadd('activity:wallets', lc(address)); // remember it so we don't ask LI.FI again
        return res.status(200).json({ eligible: true, source: 'lifi' });
      }
      return res.status(200).json({ eligible: false, source: null });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { kind, txHash } = req.body || {};
    const chainId = Number(req.body?.chainId);
    const address = req.body?.address;
    if (!isTxHash(txHash)) return res.status(400).json({ error: 'A valid transaction hash is required.' });
    if (kind !== 'lifi' && !TARGETS[kind]) return res.status(400).json({ error: 'Unknown activity type.' });
    if (kind !== 'lifi' && (!Number.isInteger(chainId) || !isAddress(address))) {
      return res.status(400).json({ error: 'chainId and address are required.' });
    }

    // Each tx is counted once, even if the page reports it twice.
    const txKey = `activity:tx:${lc(txHash)}`;
    if (await redis.exists(txKey)) return res.status(200).json({ ok: true, duplicate: true });

    const result = kind === 'lifi' ? await verifyLifi(txHash) : await verifyEvm(kind, chainId, txHash, address);
    if (result.error) return res.status(422).json({ error: result.error });

    const entry = { kind, chainId: kind === 'lifi' ? result.chainId : chainId, txHash: lc(txHash), wallet: result.wallet, ts: Math.floor(Date.now() / 1000) };
    const fresh = await redis.set(txKey, 1, { nx: true });
    if (fresh) {
      await Promise.all([
        redis.sadd('activity:wallets', result.wallet),
        redis.lpush('activity:log', JSON.stringify(entry)),
      ]);
      await redis.ltrim('activity:log', 0, 49999);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('api/activity.js:', e);
    return res.status(500).json({ error: 'Could not check this transaction right now.' });
  }
};

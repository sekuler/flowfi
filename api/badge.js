// Flow Pioneer badge (contracts/FlowPioneerBadge.sol on Arc mainnet).
//
// GET  ?address=0x...  -> { minted, tokenId, open }  — what the Home card should show.
// POST { address }     -> { signature }  — mint permission for a wallet that has used FlowFi.
//   The contract only accepts a signature from BADGE_SIGNER_KEY over (contract, chainId, wallet),
//   so it is useless for any other wallet or contract.
//
// The total number of badges is NOT in the contract: it is BADGE_MAX here (env, default 300) and stays private.
// Every wallet that gets a signature is added to `badge:signed`; once that set is full, no new wallet gets one.
// A wallet asking again gets its signature again (it can still only mint once onchain).
//
// Env: BADGE_SIGNER_KEY (server only), BADGE_MAX (optional), UPSTASH_REDIS_REST_URL/TOKEN.
const { Ratelimit } = require('@upstash/ratelimit');
const { encodeAbiParameters, keccak256, encodeFunctionData, decodeFunctionResult } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { redis, lc, isAddress, clientIp, eligibilitySource } = require('./_eligibility');

const BADGE_CONTRACT = '0xb60134309c8bee9101f34601aa2e3d8b23102f9a';
const ARC_CHAIN_ID = 5042n;
const ARC_MAINNET_RPC_URL = process.env.ARC_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io';
const BADGE_MAX = Number(process.env.BADGE_MAX) > 0 ? Number(process.env.BADGE_MAX) : 300;

const BADGE_ABI = [
  { type: 'function', name: 'badgeOf', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
];

const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, '60 s'), prefix: 'ratelimit:badge' })
  : null;

async function readContract(functionName, args = []) {
  const data = encodeFunctionData({ abi: BADGE_ABI, functionName, args });
  const r = await fetch(ARC_MAINNET_RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BADGE_CONTRACT, data }, 'latest'] }),
  });
  const d = await r.json();
  if (d.error || !d.result) throw new Error(d.error?.message || 'RPC error');
  return decodeFunctionResult({ abi: BADGE_ABI, functionName, data: d.result });
}

module.exports = async function handler(req, res) {
  if (!redis) return res.status(503).json({ error: 'Badge is not configured.' });
  const { success } = await ratelimit.limit(clientIp(req));
  if (!success) return res.status(429).json({ error: 'Too many requests — please slow down.' });

  const address = req.method === 'GET' ? req.query?.address : req.body?.address;
  if (!isAddress(address)) return res.status(400).json({ error: 'A valid address is required.' });
  const wallet = lc(address);

  try {
    const [tokenId, paused, alreadySigned, signedCount] = await Promise.all([
      readContract('badgeOf', [wallet]),
      readContract('paused'),
      redis.sismember('badge:signed', wallet),
      redis.scard('badge:signed'),
    ]);
    const minted = tokenId > 0n;
    // Open for this wallet if it already holds a signature, or if there is still room for a new one.
    const open = !paused && (alreadySigned === 1 || signedCount < BADGE_MAX);

    if (req.method === 'GET') {
      return res.status(200).json({ minted, tokenId: minted ? Number(tokenId) : null, open });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (minted) return res.status(409).json({ error: 'This wallet already has its Flow Pioneer badge.' });
    if (!open) return res.status(410).json({ error: 'Flow Pioneer badges are no longer available.' });
    if (!(await eligibilitySource(wallet))) {
      return res.status(403).json({ error: 'Make your first transaction on FlowFi to claim it.', notEligible: true });
    }

    if (!alreadySigned) {
      await redis.sadd('badge:signed', wallet);
      // Two wallets could pass the count check at the same moment; if that pushed the set over the limit, undo ours.
      if ((await redis.scard('badge:signed')) > BADGE_MAX) {
        await redis.srem('badge:signed', wallet);
        return res.status(410).json({ error: 'Flow Pioneer badges are no longer available.' });
      }
    }

    const key = process.env.BADGE_SIGNER_KEY;
    if (!key) return res.status(503).json({ error: 'Badge is not configured.' });
    const digest = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }],
      [BADGE_CONTRACT, ARC_CHAIN_ID, wallet],
    ));
    const signature = await privateKeyToAccount(key).signMessage({ message: { raw: digest } });
    return res.status(200).json({ signature });
  } catch (e) {
    console.error('api/badge.js:', e);
    return res.status(500).json({ error: 'Could not check the badge right now. Please try again.' });
  }
};

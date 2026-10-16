// Shared by api/activity.js and api/badge.js (the leading "_" keeps Vercel from exposing this file as a route).
// "Has this wallet used FlowFi?" — our own verified activity log first, then LI.FI transfers tagged "flowfi".
const { Redis } = require('@upstash/redis');

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const LIFI_API = 'https://li.quest';
const INTEGRATOR = 'flowfi';
const MAINNET_LAUNCH_TS = 1789516800; // 2026-09-16 00:00 UTC — LI.FI lookups start here

const lc = (a) => a.toLowerCase();
const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

async function lifiHasTransfer(address) {
  const q = new URLSearchParams({ integrator: INTEGRATOR, wallet: address, status: 'DONE', fromTimestamp: String(MAINNET_LAUNCH_TS), limit: '1' });
  const r = await fetch(`${LIFI_API}/v2/analytics/transfers?${q}`);
  if (!r.ok) return false;
  const d = await r.json();
  return (d?.data?.length ?? d?.transfers?.length ?? 0) > 0;
}

// Returns 'flowfi' | 'lifi' | null. A LI.FI match is remembered so LI.FI isn't asked again.
async function eligibilitySource(address) {
  if (await redis.sismember('activity:wallets', lc(address))) return 'flowfi';
  if (await lifiHasTransfer(address)) {
    await redis.sadd('activity:wallets', lc(address));
    return 'lifi';
  }
  return null;
}

module.exports = { redis, lc, isAddress, clientIp, eligibilitySource, LIFI_API, INTEGRATOR };

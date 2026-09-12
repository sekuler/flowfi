// Proxies JSON-RPC calls to Arc Testnet. Two problems this solves at once:
//
// 1. Arc's own public RPC (rpc.testnet.arc.network) doesn't return CORS headers,
//    so calling it directly from a browser fails (confirmed: circlefin/arc-node#90).
//    A backend proxy sidesteps that entirely — the request never leaves our server.
// 2. The app was previously calling a *keyed* provider (Alchemy) directly from the
//    browser, with the key hardcoded in client-side source. That key is now
//    server-side only, read from an environment variable never bundled into the
//    frontend.
//
// This is a thin JSON-RPC passthrough — it doesn't inspect or restrict methods,
// same as any RPC endpoint (reads and signed-transaction broadcasts are both
// normal, harmless RPC traffic; the actual private key never touches this server).
// It IS rate-limited per IP though — with no cap at all, this was an open relay:
// anyone could point arbitrary RPC traffic (including expensive calls like
// eth_getLogs) through it and run up whatever quota/cost the underlying
// provider (Alchemy, if ARC_RPC_URL is set) charges.
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

let ratelimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Generous limit — a normal session makes many legitimate RPC calls
  // (balance/reserve reads, tx status polling, etc.). This is a brake on
  // sustained abuse from one IP, not a cap on normal usage.
  ratelimit = new Ratelimit({
    redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }),
    limiter: Ratelimit.slidingWindow(120, '60 s'),
    prefix: 'ratelimit:rpc-proxy',
  });
} else {
  console.warn('api/rpc-proxy.js: UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is OFF.');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (ratelimit) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return res.status(429).json({ error: 'Too many RPC requests — please slow down.' });
    }
  }

  try {
    const response = await fetch(ARC_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

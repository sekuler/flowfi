// Records a transaction the user just signed through FlowFi (see api/_lib/flowStats.js).
// POST { hash, chainId, from, source }  ->  { status: "recorded" | "duplicate" | "pending" | "rejected" }
// "pending" means the tx isn't mined yet; the app retries a few times.
const { Ratelimit } = require('@upstash/ratelimit');
const { track, redis, store, clientIp } = require('./_lib/flowStats');

const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(40, '60 s'), prefix: 'ratelimit:track' })
  : null;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!store.available()) return res.status(503).json({ error: 'Stats storage is not configured.' });

  if (ratelimit && !(await ratelimit.limit(clientIp(req))).success) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }

  try {
    const result = await track(body);
    return res.status(200).json(result);
  } catch (e) {
    console.error('track error:', e?.message);
    return res.status(200).json({ status: 'pending' });
  }
};

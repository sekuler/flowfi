// FlowFi's own activity counter, verified onchain (see api/_lib/flowStats.js).
// One function for both directions, because the Vercel Hobby plan allows at most 12 functions.
//
// POST /api/stats { hash, chainId, from, source }
//      -> records a tx the user just signed through FlowFi:
//         { status: "recorded" | "duplicate" | "pending" | "rejected" }  ("pending" = not mined yet; the app retries)
// GET  /api/stats?key=<STATS_KEY>              -> totals, per chain, last 30 days
// GET  /api/stats?key=<STATS_KEY>&days=90      -> longer daily series (max 365)
// GET  /api/stats?key=<STATS_KEY>&export=500   -> the most recent verified txs (hash, chain, volume, time)
// Reading is private: without the right key it answers 404, as if the page didn't exist.
const { Ratelimit } = require('@upstash/ratelimit');
const { track, summary, exportLog, redis, store, clientIp, isProd } = require('./_lib/flowStats');

const trackLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(40, '60 s'), prefix: 'ratelimit:track' })
  : null;
const readLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '60 s'), prefix: 'ratelimit:stats' })
  : null;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!store.available()) return res.status(503).json({ error: 'Stats storage is not configured.' });

  if (req.method === 'POST') {
    if (trackLimit && !(await trackLimit.limit(clientIp(req))).success) return res.status(429).json({ error: 'Too many requests.' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    try {
      return res.status(200).json(await track(body));
    } catch (e) {
      console.error('track error:', e?.message);
      return res.status(200).json({ status: 'pending' });
    }
  }

  if (readLimit && !(await readLimit.limit(clientIp(req))).success) return res.status(429).json({ error: 'Too many requests.' });
  // Reading is private: only with the secret STATS_KEY (Vercel env var). Closed if it isn't set.
  const key = process.env.STATS_KEY;
  const given = req.headers['x-stats-key'] || req.query?.key;
  // (Local `npm run dev` without a key stays open so you can test.)
  if (isProd || key) { if (!key || given !== key) return res.status(404).json({ error: 'Not found' }); }
  try {
    if (req.query?.export !== undefined) {
      const rows = await exportLog(Number(req.query.export) || 500);
      return res.status(200).json({ count: rows.length, transactions: rows });
    }
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await summary({ days }));
  } catch (e) {
    console.error('stats error:', e?.message);
    return res.status(502).json({ error: 'Stats temporarily unavailable.' });
  }
};

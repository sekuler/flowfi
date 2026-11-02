// FlowFi activity totals, verified onchain (see api/_lib/flowStats.js).
// GET /api/stats                  -> totals, per chain, last 30 days
// GET /api/stats?days=90          -> longer daily series (max 365)
// GET /api/stats?export=500       -> the most recent verified txs (hash, chain, volume, time)
//                                    Requires header  x-stats-token: <STATS_EXPORT_TOKEN>.
const { Ratelimit } = require('@upstash/ratelimit');
const { summary, exportLog, redis, store, clientIp } = require('./_lib/flowStats');

const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '60 s'), prefix: 'ratelimit:stats' })
  : null;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!store.available()) return res.status(503).json({ error: 'Stats storage is not configured.' });
  if (ratelimit && !(await ratelimit.limit(clientIp(req))).success) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  try {
    if (req.query?.export !== undefined) {
      const token = process.env.STATS_EXPORT_TOKEN;
      if (!token || req.headers['x-stats-token'] !== token) return res.status(401).json({ error: 'Not authorized.' });
      const rows = await exportLog(Number(req.query.export) || 500);
      return res.status(200).json({ count: rows.length, transactions: rows });
    }
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(await summary({ days }));
  } catch (e) {
    console.error('stats error:', e?.message);
    return res.status(502).json({ error: 'Stats temporarily unavailable.' });
  }
};

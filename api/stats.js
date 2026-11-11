// FlowFi's own activity counter, verified onchain (see api/_lib/flowStats.js).
// One function for both directions, because the Vercel Hobby plan allows at most 12 functions.
//
// POST /api/stats { hash, chainId, from, source }
//      -> records a tx the user just signed through FlowFi:
//         { status: "recorded" | "duplicate" | "pending" | "rejected" }  ("pending" = not mined yet; the app retries)
// GET  /api/stats?key=<STATS_KEY>&view=1       -> the same numbers as a page: totals, volume per feature
//                                                 (Any bridge, Native bridge USDC/EURC/cirBTC, Swap, ...),
//                                                 recent txs with token + chain route, daily, top wallets
// GET  /api/stats?key=<STATS_KEY>              -> totals, per feature, per chain, last 30 days (JSON)
// GET  /api/stats?key=<STATS_KEY>&days=90      -> longer daily series (max 365)
// GET  /api/stats?key=<STATS_KEY>&export=500   -> the most recent verified txs (hash, chain, volume, time)
// GET  /api/stats?key=<STATS_KEY>&wallets=1    -> every wallet with its total volume and tx count (highest first)
// GET  /api/stats?key=<STATS_KEY>&wallet=0x... -> one wallet's total volume and tx count
// GET  /api/stats?key=<STATS_KEY>&view=1&add=<tx hash>&chain=5042
//                                              -> adds a tx the counter missed (any age); the page has a form for it
// GET  /api/stats?key=<STATS_KEY>&view=1&opening=<usd>&openingTxs=<n>
//                                              -> sets the lump figure for the time before the counter (0 removes it)
// Every read first pulls any new LI.FI transfers of ours (at most once a minute), so the totals are current.
// Reading is private: without the right key it answers 404, as if the page didn't exist.
const { Ratelimit } = require('@upstash/ratelimit');
const { render } = require('./_lib/statsView');
const backfill = require('./_lib/statsBackfill');
const { addManual, setOpening, track, sync, wallets, summary, exportLog, redis, store, clientIp, isProd } = require('./_lib/flowStats');

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
  const startedAt = Date.now();
  try {
    res.setHeader('Cache-Control', 'no-store');
    const lifi = await sync().catch(() => ({ ok: false }));
    // History scan for the time before the counter: a few seconds per read, until it is finished.
    const past = await backfill.step(Math.max(Date.now(), startedAt + 7000)).catch(() => backfill.status().catch(() => null));
    if (req.query?.wallet) return res.status(200).json({ ...(await wallets({ wallet: req.query.wallet })), lifiSynced: !!lifi.ok });
    if (req.query?.wallets !== undefined) return res.status(200).json({ ...(await wallets()), lifiSynced: !!lifi.ok });
    if (req.query?.export !== undefined) {
      const rows = await exportLog(Number(req.query.export) || 500);
      return res.status(200).json({ count: rows.length, transactions: rows });
    }
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
    let added = null;
    if (req.query?.opening !== undefined && req.query.opening !== '') {
      added = await setOpening({ volumeUsd: req.query.opening, transactions: req.query.openingTxs });
      if (req.query?.view === undefined) return res.status(200).json(added);
    } else if (req.query?.add) {
      added = await addManual({ hash: req.query.add, chainId: req.query.chain, feature: req.query.feature }).catch(() => ({ status: 'rejected', reason: 'could not be checked right now' }));
      if (req.query?.view === undefined) return res.status(200).json(added);
    }
    if (req.query?.view !== undefined) {
      const [sum, rows, top] = await Promise.all([summary({ days }), exportLog(200), wallets()]);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.status(200).send(render({ summary: sum, rows, wallets: top.wallets, key: given, lifiSynced: !!lifi.ok, added, past }));
    }
    // lifiSynced: false means LI.FI couldn't be read just now, so recent LI.FI routes may be missing.
    return res.status(200).json({ ...(await summary({ days })), backfill: past, lifiSynced: !!lifi.ok });
  } catch (e) {
    console.error('stats error:', e?.message);
    return res.status(502).json({ error: 'Stats temporarily unavailable.' });
  }
};

// api/dropstab.js
//
// Proxy for DropsTab's token unlock API. The real key lives ONLY here as a
// server-side env var (DROPSTAB_API_KEY, no VITE_ prefix). Frontend calls
// GET /api/dropstab?coinSlug=aptos and gets DropsTab's real unlock schedule
// back — replacing the manually-curated tokenUnlocks.ts list with live data
// for any token DropsTab tracks.
//
// Cached 10 minutes per coin (unlock schedules change slowly) to conserve
// the free-tier Builders Program quota — this key is time-limited (3
// months) and shared across all FlowFi users, so we're deliberately
// conservative with call volume.

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // coinSlug -> { data, timestamp }

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
  }

  const apiKey = process.env.DROPSTAB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: DROPSTAB_API_KEY not set" });
  }

  const coinSlug = req.query.coinSlug;
  if (!coinSlug) {
    return res.status(400).json({ error: "Missing coinSlug query parameter" });
  }

  const cached = cache.get(coinSlug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.data, cached: true });
  }

  try {
    const response = await fetch(`https://public-api.dropstab.com/api/v1/tokenUnlocks/${coinSlug}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      // Not every token is tracked by DropsTab — a 404 here is expected and
      // normal, not a real error. Let the caller fall back gracefully.
      return res.status(response.status).json({ error: `DropsTab returned ${response.status} for ${coinSlug}` });
    }

    const data = await response.json();
    cache.set(coinSlug, { data, timestamp: Date.now() });
    return res.status(200).json({ ...data, cached: false });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

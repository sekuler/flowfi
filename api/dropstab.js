// api/dropstab.js
//
// Proxy for DropsTab's token unlock API. The real key lives ONLY here as a
// server-side env var (DROPSTAB_API_KEY, no VITE_ prefix).
//
// Our Builders Program access is the "Advanced" plan, which does NOT
// include the per-token detail endpoint (/tokenUnlocks/{coinSlug} returns
// 403). What IS included is the general overview endpoint (/tokenUnlocks),
// which returns unlock data for many tracked tokens in one call. So instead
// of querying per-coin, we fetch that full list ONCE, cache it, and search
// within it for whatever coin the frontend asks about.
//
// The full list is cached for 30 minutes (unlock schedules move slowly, and
// this keeps us well within the free-tier Builders Program quota).

const CACHE_TTL_MS = 30 * 60 * 1000;
let overviewCache = null; // { data, timestamp }

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

async function getOverviewList(apiKey) {
  if (overviewCache && Date.now() - overviewCache.timestamp < CACHE_TTL_MS) {
    return overviewCache.data;
  }
  const response = await fetch("https://public-api.dropstab.com/api/v1/tokenUnlocks", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`DropsTab overview returned ${response.status}`);
  }
  const data = await response.json();
  overviewCache = { data, timestamp: Date.now() };
  return data;
}

// The overview endpoint's exact shape isn't fully documented — handle a
// few plausible array locations rather than assuming one.
function extractList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.tokens)) return raw.tokens;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

// Matches loosely on coin name, symbol, or slug — we don't know DropsTab's
// exact field names for certain, so we check several plausible ones.
function findMatch(list, coinSlug) {
  const needle = coinSlug.toLowerCase();
  return list.find((item) => {
    const candidates = [item.coin, item.slug, item.symbol, item.name, item.token]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    return candidates.some((c) => c === needle || c.replace(/\s+/g, "-") === needle);
  });
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

  // Temporary debug mode — returns DropsTab's raw response shape unmodified
  // so we can see exactly what field names it uses, instead of guessing.
  // Remove this once the real shape is confirmed and matching works.
  if (req.query.debug === "raw") {
    try {
      const raw = await getOverviewList(apiKey);
      const list = extractList(raw);
      return res.status(200).json({
        status: raw?.status,
        failure: raw?.failure,
        failureDetails: raw?.failureDetails,
        dataType: Array.isArray(raw?.data) ? "array" : typeof raw?.data,
        dataValue: raw?.data,
        rawTopLevelKeys: raw && typeof raw === "object" ? Object.keys(raw) : typeof raw,
        extractedListLength: list.length,
        firstThreeItems: list.slice(0, 3),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Internal error" });
    }
  }
  if (!coinSlug) {
    return res.status(400).json({ error: "Missing coinSlug query parameter" });
  }

  try {
    const raw = await getOverviewList(apiKey);
    const list = extractList(raw);
    const match = findMatch(list, coinSlug);
    if (!match) {
      return res.status(404).json({ error: `${coinSlug} not found in DropsTab's tracked unlock list` });
    }
    return res.status(200).json(match);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

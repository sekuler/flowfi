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
  // The response shape ({content, ...}) matches a typical paginated API —
  // request a large page size explicitly rather than relying on a default
  // that turned out to be only 10 items.
  const response = await fetch("https://public-api.dropstab.com/api/v1/tokenUnlocks?size=500", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`DropsTab overview returned ${response.status}`);
  }
  const data = await response.json();
  overviewCache = { data, timestamp: Date.now() };
  return data;
}

// Confirmed real shape (2026-08-17): the array lives at data.content, and
// each item uses coinSlug / coinSymbol as its identifiers.
function extractList(raw) {
  if (Array.isArray(raw?.data?.content)) return raw.data.content;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function findMatch(list, coinSlug) {
  const needle = coinSlug.toLowerCase();
  return list.find((item) => {
    const candidates = [item.coinSlug, item.coinSymbol].filter(Boolean).map((s) => String(s).toLowerCase());
    return candidates.includes(needle);
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

  // Temporary search mode — finds entries whose slug/symbol CONTAINS the
  // query, to discover DropsTab's real slug when it doesn't match
  // CoinGecko's id exactly. Remove once we've mapped the tokens we need.
  if (req.query.debug === "search") {
    try {
      const raw = await getOverviewList(apiKey);
      const list = extractList(raw);
      const needle = coinSlug.toLowerCase();
      const matches = list
        .filter((item) => (item.coinSlug ?? "").toLowerCase().includes(needle) || (item.coinSymbol ?? "").toLowerCase().includes(needle))
        .map((item) => ({ coinSlug: item.coinSlug, coinSymbol: item.coinSymbol }));
      return res.status(200).json({
        listLength: list.length,
        totalElementsField: raw?.data?.totalElements ?? raw?.totalElements ?? "not found",
        totalPagesField: raw?.data?.totalPages ?? raw?.totalPages ?? "not found",
        matches,
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

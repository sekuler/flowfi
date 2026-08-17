// api/dropstab.js
//
// Proxy for DropsTab's token unlock API. The real key lives ONLY here as a
// server-side env var (DROPSTAB_API_KEY, no VITE_ prefix).
//
// Confirmed facts (2026-08-17, via direct testing):
// - Our Builders Program "Advanced" access does NOT include the per-token
//   endpoint (/tokenUnlocks/{coinSlug} → 403).
// - The general overview endpoint (/tokenUnlocks) DOES work, but is
//   paginated at exactly 10 items per page, with up to ~101 pages total.
//   A ?size= override was tried and rejected (400) — page size is fixed.
// - Real shape: { status, failure, failureDetails, data: { content: [...] } }
//   Each item: { coinSlug, coinSymbol, allocations: [{ name,
//   tokenUnlockProgress: { nextTokenUnlockDate, lockedTokensAmount,
//   lockedTokensPercent, ... } | null }], totalTokensUnlockedPercent, ... }
//
// Strategy: keep a single accumulating in-memory cache of every page we've
// ever fetched (across all requests, while this instance stays warm). When
// a coin isn't in the cache yet, fetch pages one at a time (page=0,1,2...)
// adding each to the cache, until we find a match or exhaust all pages.
// This means the FIRST lookup of an unseen coin may need several calls,
// but every subsequent lookup — of that coin or any coin already seen —
// is instant from cache. Capped at 25 pages per single request so one
// unlucky lookup can't hang forever; the coin simply isn't found this time
// and a later request continues past where this one stopped.

const MAX_PAGES_PER_REQUEST = 25;
const coinCache = new Map(); // coinSlug|coinSymbol (lowercase) -> item
let highestPageFetched = -1;
let totalPagesKnown = null;

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

async function fetchPage(apiKey, page) {
  const response = await fetch(`https://public-api.dropstab.com/api/v1/tokenUnlocks?page=${page}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "(could not read body)");
    throw new Error(`DropsTab page ${page} returned ${response.status}: ${bodyText}`);
  }
  const raw = await response.json();
  const content = raw?.data?.content;
  const items = Array.isArray(content) ? content : [];
  if (typeof raw?.data?.totalPages === "number") totalPagesKnown = raw.data.totalPages;
  for (const item of items) {
    if (item.coinSlug) coinCache.set(String(item.coinSlug).toLowerCase(), item);
    if (item.coinSymbol) coinCache.set(String(item.coinSymbol).toLowerCase(), item);
  }
  return items;
}

async function findCoin(apiKey, coinSlug) {
  const needle = coinSlug.toLowerCase();
  if (coinCache.has(needle)) return coinCache.get(needle);

  let pagesFetchedThisRequest = 0;
  let page = highestPageFetched + 1;
  while (pagesFetchedThisRequest < MAX_PAGES_PER_REQUEST) {
    if (totalPagesKnown !== null && page >= totalPagesKnown) break;
    await fetchPage(apiKey, page);
    highestPageFetched = Math.max(highestPageFetched, page);
    pagesFetchedThisRequest++;
    if (coinCache.has(needle)) return coinCache.get(needle);
    page++;
  }
  return null; // Not found within pages fetched so far — try again shortly, more pages will be cached.
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

  try {
    const match = await findCoin(apiKey, coinSlug);
    if (!match) {
      return res.status(404).json({
        error: `${coinSlug} not found in DropsTab's tracked unlock list (checked pages 0-${highestPageFetched} of ${totalPagesKnown ?? "?"})`,
      });
    }
    return res.status(200).json(match);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};


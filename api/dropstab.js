// api/dropstab.js
//
// Proxy for DropsTab's token unlock API. The real key lives ONLY here as a
// server-side env var (DROPSTAB_API_KEY, no VITE_ prefix).
//
// Confirmed facts (2026-08-17, via direct testing):
// - Our Builders Program "Advanced" access does NOT include the per-token
//   endpoint (/tokenUnlocks/{coinSlug} → 403).
// - The general overview endpoint (/tokenUnlocks) works, paginated at 10
//   items/page, up to ~101 pages total. ?size= override is rejected (400).
// - Real shape: { status, failure, failureDetails, data: { content: [...],
//   totalPages } }. Each item: { coinSlug, coinSymbol, allocations: [{ name,
//   tokenUnlockProgress: { nextTokenUnlockDate, lockedTokensAmount,
//   lockedTokensPercent, ... } | null }], totalTokensUnlockedPercent, ... }
// - Vercel serverless functions do NOT reliably share in-memory state
//   between invocations (different requests can land on different warm
//   instances) — a "search one page at a time, remember where we left off"
//   approach silently resets and fails intermittently. Confirmed by a
//   direct test succeeding, then the same coin failing from within the app
//   moments later (fresh instance, cache empty, only got through page 24
//   before hitting the per-request page cap).
//
// Fix: fetch pages in PARALLEL batches within a single request instead of
// one at a time. This covers all ~101 pages in a few seconds instead of
// timing out — no reliance on state surviving between invocations.

const BATCH_SIZE = 20; // concurrent requests per batch
const MAX_PAGES = 101; // covers the full known range

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
  try {
    const response = await fetch(`https://public-api.dropstab.com/api/v1/tokenUnlocks?page=${page}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return { items: [], totalPages: null };
    const raw = await response.json();
    const content = raw?.data?.content;
    return {
      items: Array.isArray(content) ? content : [],
      totalPages: typeof raw?.data?.totalPages === "number" ? raw.data.totalPages : null,
    };
  } catch {
    return { items: [], totalPages: null };
  }
}

function findInItems(items, needle) {
  return items.find((item) => {
    const slug = item.coinSlug ? String(item.coinSlug).toLowerCase() : null;
    const symbol = item.coinSymbol ? String(item.coinSymbol).toLowerCase() : null;
    return slug === needle || symbol === needle;
  });
}

async function findCoinAcrossAllPages(apiKey, coinSlug) {
  const needle = coinSlug.toLowerCase();

  // First page tells us the real totalPages so we don't over-fetch.
  const first = await fetchPage(apiKey, 0);
  const match0 = findInItems(first.items, needle);
  if (match0) return match0;

  const totalPages = Math.min(first.totalPages ?? MAX_PAGES, MAX_PAGES);
  if (totalPages <= 1) return null;

  for (let start = 1; start < totalPages; start += BATCH_SIZE) {
    const batchPages = [];
    for (let p = start; p < Math.min(start + BATCH_SIZE, totalPages); p++) batchPages.push(p);
    const results = await Promise.all(batchPages.map((p) => fetchPage(apiKey, p)));
    for (const r of results) {
      const found = findInItems(r.items, needle);
      if (found) return found;
    }
  }
  return null;
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
    const match = await findCoinAcrossAllPages(apiKey, coinSlug);
    if (!match) {
      return res.status(404).json({ error: `${coinSlug} not found in DropsTab's tracked unlock list` });
    }
    return res.status(200).json(match);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

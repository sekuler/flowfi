// Proxies Arcscan's (Blockscout-style) explorer API. Calling testnet.arcscan.app/api
// directly from the browser is unreliable — other Arc Testnet projects have hit the
// same CORS wall and solved it the same way: fetch server-side instead.
//
// Seven different pages (History, Dashboard, Home, Swap, Send, ...) all call this
// same endpoint, previously with zero caching — every navigation re-fetched the same
// data fresh, and a burst of legitimate traffic could trip Arcscan's own rate limit
// (confirmed: "Explorer API error (429)"). Two real mitigations, not just a nicer
// error message:
//   1. A short in-memory cache, keyed by the exact query — identical requests within
//      the cache window are served from memory instead of hitting Arcscan again.
//      (Per-instance only, like any in-memory cache on Vercel — still cuts real load
//      meaningfully within a warm instance's lifetime, and unlike a rate-limit counter,
//      a cache doesn't need to be globally exact to be useful.)
//   2. Automatic retries with short backoff specifically on 429, since explorer rate
//      limits are typically a short rolling window — often gone within a second or two.
//
// Also used with ?module=logs&action=getLogs (Blockscout's Etherscan-compatible log
// endpoint) as a fallback source for event logs when eth_getLogs on the RPC itself is
// unreliable (a real, confirmed issue on Arc Testnet's public RPC) — this reads from
// Arcscan's own indexed database instead, same query shape, no extra code needed here.
const ARCSCAN_ORIGIN = 'https://testnet.arcscan.app';
const CACHE_TTL_MS = 30 * 1000; // bumped from 20s — real usage today (more pools, more activity) showed 20s wasn't cutting enough repeat calls
const cache = new Map(); // key -> { status, contentType, body, expiresAt }
const RETRY_DELAYS_MS = [0, 600, 1500, 3000, 5000]; // more attempts, longer max wait — 3 tries wasn't enough under today's real traffic

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const query = req.query || {};
    const params = new URLSearchParams();
    for (const key of Object.keys(query)) {
      const value = query[key];
      if (Array.isArray(value)) {
        params.set(key, value[0]);
      } else if (value !== undefined) {
        params.set(key, value);
      }
    }
    const cacheKey = params.toString();

    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.status(cached.status);
      res.setHeader('Content-Type', cached.contentType);
      return res.send(cached.body);
    }

    let response = null;
    let text = '';
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);
      response = await fetch(`${ARCSCAN_ORIGIN}/api?${params.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      text = await response.text();
      if (response.status !== 429) break;
    }

    const contentType = response.headers.get('content-type') || 'application/json';

    // Only cache genuine successes — never cache a 429/5xx, or a real fix would
    // get masked behind a stale error for the rest of the cache window.
    if (response.status >= 200 && response.status < 300) {
      cache.set(cacheKey, { status: response.status, contentType, body: text, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    res.status(response.status);
    res.setHeader('Content-Type', contentType);
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// api/claude.js
//
// Proxy for all Claude API calls. The real Anthropic key lives ONLY here,
// as a server-side env var (ANTHROPIC_API_KEY, no VITE_ prefix so Vite
// never bundles it into client-side JS). The frontend sends { model,
// max_tokens, system, messages } and gets Anthropic's raw response back —
// same shape as calling Anthropic directly, so callers barely change.
//
// Rate limit: since every user shares this one server-side key, a per-IP
// limit protects against a single abusive client (or a bug causing a tight
// retry loop) from burning through the whole account's credit balance.

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20; // per IP, per window
const requestLog = new Map(); // ip -> array of request timestamps

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" });
  }

  try {
    const { model, max_tokens, system, messages } = req.body ?? {};
    if (!model || !max_tokens || !messages) {
      return res.status(400).json({ error: "Missing required fields: model, max_tokens, messages" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

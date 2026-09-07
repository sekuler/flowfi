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
//
// This used to be a plain in-memory Map — which only counts requests seen
// by ONE serverless instance. Under real traffic Vercel runs several
// instances of the same function concurrently, so that limit was really
// "20 requests per instance per minute", not 20 total — a client whose
// requests happened to land on different instances could blow past it
// entirely. Upstash Redis is a real shared store every instance talks to
// over HTTP (no persistent connection needed, which is what makes it work
// in a serverless function at all), so the count is now genuinely global.
//
// Requires two env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// (free tier at upstash.com — create a Redis database, both values are on
// its detail page). If they're not set, rate limiting is skipped entirely
// (logged once) rather than silently falling back to the old broken
// per-instance counter, which was never a real limit to begin with.
const { Ratelimit } = require("@upstash/ratelimit");
const { Redis } = require("@upstash/redis");

let ratelimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  ratelimit = new Ratelimit({
    redis: new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(20, "60 s"), // 20 requests per IP per minute, shared across all instances
    prefix: "ratelimit:claude",
  });
} else {
  console.warn("api/claude.js: UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is OFF, not falling back to a per-instance approximation.");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (ratelimit) {
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
    }
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

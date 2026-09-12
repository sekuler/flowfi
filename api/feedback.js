// api/feedback.js
//
// Sends in-app feedback straight to a Telegram chat via the Bot API. Both
// the bot token and chat id live ONLY here as server-side env vars
// (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, no VITE_ prefix) — the bot token
// is a secret (anyone with it could send messages as the bot), so it must
// never reach the browser.
//
// Rate-limited per IP — with none at all, this was an open POST endpoint
// that would forward whatever a caller sent straight into the team's
// Telegram chat, with no cost to the caller and no limit on volume.
const { Ratelimit } = require("@upstash/ratelimit");
const { Redis } = require("@upstash/redis");

let ratelimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  ratelimit = new Ratelimit({
    redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }),
    limiter: Ratelimit.slidingWindow(5, "600 s"), // 5 feedback messages per IP per 10 minutes
    prefix: "ratelimit:feedback",
  });
} else {
  console.warn("api/feedback.js: UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is OFF.");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (ratelimit) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return res.status(429).json({ error: "Too much feedback too fast — please wait a bit." });
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return res.status(500).json({ error: "Server misconfigured: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" });
  }

  const { message, page } = req.body ?? {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing feedback message" });
  }

  try {
    const text = `📝 New FlowFi Feedback${page ? ` (from: ${page})` : ""}\n${message.trim().slice(0, 3800)}`;
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return res.status(502).json({ error: `Telegram returned ${response.status}: ${body}` });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

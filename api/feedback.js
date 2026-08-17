// api/feedback.js
//
// Sends in-app feedback straight to a Discord channel via webhook. The
// webhook URL lives ONLY here as a server-side env var (DISCORD_WEBHOOK_URL,
// no VITE_ prefix) — a webhook URL is effectively a secret (anyone with it
// could post to the channel), so it must never reach the browser.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: "Server misconfigured: DISCORD_WEBHOOK_URL not set" });
  }

  const { message, page } = req.body ?? {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing feedback message" });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `📝 **New FlowFi Feedback**${page ? ` (from: ${page})` : ""}\n${message.trim().slice(0, 1800)}`,
      }),
    });
    if (!response.ok) {
      return res.status(502).json({ error: `Discord webhook returned ${response.status}` });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

// api/claude.js
//
// Proxy for all Claude API calls. The real Anthropic key lives ONLY here,
// as a server-side env var (ANTHROPIC_API_KEY, no VITE_ prefix so Vite
// never bundles it into client-side JS). The frontend sends { model,
// max_tokens, system, messages } and gets Anthropic's raw response back —
// same shape as calling Anthropic directly, so callers barely change.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

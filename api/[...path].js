// Proxies Relay's API for the mainnet Bridge & Swap widget.
//
// Unlike LI.FI's API key (deliberately client-exposed, like a publishable
// key — see MainnetBridge.tsx), Relay's own docs explicitly warn against
// sending their key from the browser: "Set baseApiUrl to a server-side
// proxy that injects x-api-key — do not pass the key from the browser."
// This file IS that proxy — RELAY_API_KEY lives only here, server-side,
// never in any VITE_-prefixed client env var.
//
// The widget's RelayKitProvider is configured with baseApiUrl pointing at
// this endpoint instead of Relay's real API — every request the widget
// makes (quotes, execution status, chain list) flows through here first.
const RELAY_API_ORIGIN = 'https://api.relay.link';

module.exports = async function handler(req, res) {
  if (!process.env.RELAY_API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: RELAY_API_KEY is not set.' });
  }

  // req.url already includes the path + query string Vercel routed here
  // (e.g. "/api/relay-proxy/chains" -> forwarded as "/chains"), since this
  // is deployed as a catch-all route — see vercel.json rewrite below.
  const forwardPath = req.url.replace(/^\/api\/relay-proxy/, '') || '/';

  try {
    const response = await fetch(`${RELAY_API_ORIGIN}${forwardPath}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.RELAY_API_KEY,
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });
    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

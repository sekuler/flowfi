// Proxies JSON-RPC calls to Arc Testnet. Two problems this solves at once:
//
// 1. Arc's own public RPC (rpc.testnet.arc.network) doesn't return CORS headers,
//    so calling it directly from a browser fails (confirmed: circlefin/arc-node#90).
//    A backend proxy sidesteps that entirely — the request never leaves our server.
// 2. The app was previously calling a *keyed* provider (Alchemy) directly from the
//    browser, with the key hardcoded in client-side source. That key is now
//    server-side only, read from an environment variable never bundled into the
//    frontend.
//
// This is a thin JSON-RPC passthrough — it doesn't inspect or restrict methods,
// same as any RPC endpoint (reads and signed-transaction broadcasts are both
// normal, harmless RPC traffic; the actual private key never touches this server).
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(ARC_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

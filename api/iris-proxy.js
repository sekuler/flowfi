// Generic proxy for Circle's IRIS sandbox API (iris-api-sandbox.circle.com).
// The bridge calls several IRIS endpoints — attestation polling (GET), CCTPx token
// lookup (GET), CCTPx fast-transfer allowance (GET), and the CCTPx fee quote (POST).
// At least the POST quote endpoint rejects direct browser calls (CORS preflight
// failure — Circle's own quickstart for it is a Node.js script, not a browser page),
// so every one of these calls is routed through here instead of straight from the
// client, removing any dependency on Circle's per-endpoint CORS configuration.
//
// GET  /api/iris-proxy?path=%2Fv2%2Fmessages%2F0%3FtransactionHash%3D0x...
// POST /api/iris-proxy   body: { path: "/v1/quote/cctpx/{tokenId}/{src}/{dst}", body: {...} }
const IRIS_ORIGIN = 'https://iris-api-sandbox.circle.com';

module.exports = async function handler(req, res) {
  try {
    let targetPath;
    let body;

    if (req.method === 'GET') {
      targetPath = req.query.path;
    } else if (req.method === 'POST') {
      targetPath = req.body && req.body.path;
      body = req.body && req.body.body;
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!targetPath || typeof targetPath !== 'string' || !targetPath.startsWith('/')) {
      return res.status(400).json({ error: 'Missing or invalid "path" — must be an absolute path like /v2/messages/0' });
    }

    const response = await fetch(`${IRIS_ORIGIN}${targetPath}`, {
      method: req.method,
      headers: req.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: req.method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Proxies Circle's CCTPx (Expanded Assets) fee-quote endpoint. The browser can't call
// https://iris-api-sandbox.circle.com/v1/quote/cctpx/... directly — it's a POST with a JSON
// body, which triggers a CORS preflight (OPTIONS) request, and that preflight fails ("Failed
// to fetch") because Circle's quickstart for this endpoint is written for a Node.js script, not
// a browser page. Doing the same POST server-side sidesteps the browser's CORS check entirely.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tokenId, sourceDomain, destDomain, amount, feeToken, requests } = req.body || {};
    if (!tokenId || sourceDomain === undefined || destDomain === undefined || !amount) {
      return res.status(400).json({ error: 'Missing tokenId, sourceDomain, destDomain, or amount' });
    }

    const response = await fetch(
      `https://iris-api-sandbox.circle.com/v1/quote/cctpx/${tokenId}/${sourceDomain}/${destDomain}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: String(amount),
          feeToken: feeToken || '0x0000000000000000000000000000000000000000',
          requests: requests || [{ type: 'PRE_FINALITY' }],
        }),
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

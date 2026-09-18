// Backend proxy + URL signer for MoonPay.
//
// MoonPay requires two separate keys with very different trust levels:
//   - Publishable key (pk_...): safe in the browser, identifies the
//     integration. Lives in VITE_MOONPAY_PUBLISHABLE_KEY (client-exposed
//     on purpose, same pattern as LI.FI's key).
//   - Secret key (sk_...): must NEVER reach the browser. Used here, and
//     only here, to HMAC-SHA256 sign widget URLs. Lives in
//     MOONPAY_SECRET_KEY (no VITE_ prefix -- server-only).
//
// Two actions:
//   "sign"        -> signs a widget URL's query string, returns the
//                     signature so the frontend can open a valid,
//                     tamper-proof MoonPay checkout link.
//   "getCurrencies" -> proxies MoonPay's public currency list. This is
//                     how we confirm the EXACT currencyCode for "USDC on
//                     Base" instead of guessing a string like
//                     "usdc_base" -- a wrong guess here could point a
//                     real purchase at the wrong network or asset.
const crypto = require('crypto');

const MOONPAY_API_ORIGIN = 'https://api.moonpay.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.MOONPAY_SECRET_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: MOONPAY_SECRET_KEY is not set.' });
  }

  const { action } = req.body ?? {};

  try {
    if (action === 'sign') {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'A "url" string is required to sign.' });
      }
      const query = new URL(url).search; // includes the leading "?"
      const signature = crypto
        .createHmac('sha256', process.env.MOONPAY_SECRET_KEY)
        .update(query)
        .digest('base64');
      return res.status(200).json({ success: true, signature });
    }

    if (action === 'getCurrencies') {
      // Public endpoint -- no secret needed for the request itself, but
      // routing it through our own backend keeps every MoonPay call in
      // one place and avoids CORS surprises from the browser.
      const response = await fetch(`${MOONPAY_API_ORIGIN}/v3/currencies`);
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    return res.status(400).json({ error: `Unknown action: "${action}".` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

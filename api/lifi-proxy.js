// Proxies LI.FI's API (li.quest/v1) so FlowFi's LI.FI API key stays server-side.
// The key used to ship in the browser bundle as VITE_LIFI_API_KEY, where anyone
// could copy it and use up its rate limit, which would then break swap and bridge
// quotes for every FlowFi user. Now the widget (sdkConfig.apiUrl) and Best price
// swap call /api/lifi-proxy/<path>, vercel.json rewrites that to ?path=<path>,
// and this function adds the key before forwarding to li.quest.
//
// Only the endpoints the LI.FI widget and SDK actually use are reachable, and
// requests are rate-limited per IP, so this can't become an open relay that
// spends the key's quota on anything else.
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

const LIFI_ORIGIN = 'https://li.quest/v1';

// [method, path]. A trailing "/" means "this prefix plus one more segment" (e.g. /gas/suggestion/5042).
const ALLOWED = [
  ['GET', '/chains'], ['GET', '/tokens'], ['GET', '/token'], ['GET', '/tools'],
  ['GET', '/connections'], ['GET', '/quote'], ['GET', '/quote/toAmount'], ['GET', '/status'],
  ['GET', '/gas/suggestion/'], ['GET', '/relayer/quote'], ['GET', '/relayer/status/'],
  ['GET', '/analytics/transfers'],
  ['POST', '/advanced/routes'], ['POST', '/advanced/stepTransaction'], ['POST', '/quote/contractCalls'],
  ['POST', '/advanced/relay'], ['POST', '/relayer/relay'], ['POST', '/patcher'],
];
const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;
function isAllowed(method, path) {
  return ALLOWED.some(([m, p]) => {
    if (m !== method) return false;
    if (!p.endsWith('/')) return path === p;
    return path.startsWith(p) && SEGMENT.test(path.slice(p.length));
  });
}

// Headers the SDK sends that LI.FI uses; everything else (cookies, the caller's own
// x-lifi-api-key, etc.) is dropped.
const FORWARD_HEADERS = ['content-type', 'x-lifi-integrator', 'x-lifi-sdk', 'x-lifi-widget', 'x-lifi-userid'];
const MAX_BODY_BYTES = 256 * 1024;

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
// Generous: the widget loads chains/tokens/tools at once and polls quotes and transfer status.
const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(300, '60 s'), prefix: 'ratelimit:lifi-proxy' })
  : null;

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString();
}

module.exports = async function handler(req, res) {
  const method = req.method;
  if (method !== 'GET' && method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const key = process.env.LIFI_API_KEY;
  if (!key && process.env.NODE_ENV === 'production') {
    console.error('lifi-proxy: LIFI_API_KEY is not set');
  }

  if (!ratelimit && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }
  if (ratelimit) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!(await ratelimit.limit(ip)).success) return res.status(429).json({ message: 'Too many requests. Please slow down.' });
  }

  const rawPath = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  const path = '/' + rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (path.includes('..') || !isAllowed(method, path)) {
    return res.status(400).json({ message: 'Unsupported LI.FI endpoint.' });
  }

  // Rebuild the query from the original URL (keeps repeated params like chains=1&chains=2), minus our own "path".
  const original = new URL(req.url || '/', 'https://flowfi.invalid');
  const params = new URLSearchParams(original.search);
  params.delete('path');
  // Transfer history is fine per wallet, but without a wallet it would list every FlowFi transfer
  // (integrator-wide analytics), which must stay private.
  if (path === '/analytics/transfers' && !/^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,64}$|^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(params.get('wallet') || '')) {
    return res.status(400).json({ message: 'A wallet is required.' });
  }
  const qs = params.toString();

  const headers = { Accept: 'application/json' };
  for (const h of FORWARD_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string' && v.length < 200) headers[h] = v;
  }
  if (key) headers['x-lifi-api-key'] = key;

  try {
    const body = method === 'POST' ? await readBody(req) : undefined;
    if (body && Buffer.byteLength(body) > MAX_BODY_BYTES) return res.status(413).json({ message: 'Request too large.' });

    const upstream = await fetch(`${LIFI_ORIGIN}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(25000),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(text);
  } catch (error) {
    if (error?.status === 413) return res.status(413).json({ message: 'Request too large.' });
    console.error('lifi-proxy error:', error?.message);
    return res.status(502).json({ message: 'Quote service unavailable. Please try again.' });
  }
};

// Uploads a token-launch image to Vercel Blob and returns a public URL.
// This replaces the "paste an already-hosted image URL" workaround — the
// creator picks a file directly, no separate image host needed.
//
// Requires a Blob store linked to this Vercel project (Storage tab →
// Create → Blob), which auto-provisions BLOB_READ_WRITE_TOKEN. Without
// it, this endpoint fails loudly (500) rather than silently accepting an
// upload that goes nowhere.
const { put } = require('@vercel/blob');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

// Anonymous public uploads with no limit turned this into free image hosting on FlowFi's
// Blob store. Token Launch is Testnet-only and a creator uploads one image per launch,
// so a small per-IP hourly allowance is plenty. Refuses to run in production without it.
const ratelimit = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Ratelimit({
      redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }),
      limiter: Ratelimit.slidingWindow(5, '3600 s'),
      prefix: 'ratelimit:upload-image',
    })
  : null;

// Vercel's default body parser caps JSON/form bodies well under what a
// real image needs — this raw-body config lets the actual file bytes
// through instead of getting silently truncated or rejected.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// The Content-Type header is client-supplied, so the file's first bytes must match it.
function matchesType(buf, type) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (type === 'image/png') return hex.startsWith('89504e470d0a1a0a');
  if (type === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (type === 'image/gif') return hex.startsWith('474946383761') || hex.startsWith('474946383961');
  if (type === 'image/webp') return hex.startsWith('52494646') && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);


function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(new Error('File too large — 5MB max.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Two valid ways this can be configured: the older static
  // BLOB_READ_WRITE_TOKEN, or the newer OIDC connection (Vercel injects
  // BLOB_STORE_ID + a short-lived token per request, never a stored env
  // var for the token itself) — @vercel/blob's put() picks whichever is
  // present automatically. Only fail if NEITHER is configured.
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return res.status(500).json({ error: 'Server misconfigured: no Blob store linked to this project (Storage tab → Create → Blob in the Vercel dashboard).' });
  }

  if (!ratelimit && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'Uploads are unavailable: rate limiting is not configured.' });
  }
  if (ratelimit) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const { success } = await ratelimit.limit(ip);
    if (!success) return res.status(429).json({ error: 'Too many uploads. Please try again later.' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!ALLOWED_TYPES.has(contentType)) {
    return res.status(400).json({ error: `Unsupported file type "${contentType}" — use PNG, JPEG, WebP, or GIF.` });
  }

  try {
    const buffer = await readRawBody(req);
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Empty file.' });
    }
    if (!matchesType(buffer, contentType)) {
      return res.status(400).json({ error: 'File content does not match its image type.' });
    }

    const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
    const filename = `token-images/${Date.now()}-${require('crypto').randomBytes(6).toString('hex')}.${ext}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType,
    });

    return res.status(200).json({ success: true, url: blob.url });
  } catch (error) {
    if (error.message === 'File too large — 5MB max.') {
      return res.status(413).json({ error: error.message });
    }
    console.error('Image upload error:', error.message);
    return res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
};

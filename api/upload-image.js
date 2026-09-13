// Uploads a token-launch image to Vercel Blob and returns a public URL.
// This replaces the "paste an already-hosted image URL" workaround — the
// creator picks a file directly, no separate image host needed.
//
// Requires a Blob store linked to this Vercel project (Storage tab →
// Create → Blob), which auto-provisions BLOB_READ_WRITE_TOKEN. Without
// it, this endpoint fails loudly (500) rather than silently accepting an
// upload that goes nowhere.
const { put } = require('@vercel/blob');

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Vercel's default body parser caps JSON/form bodies well under what a
// real image needs — this raw-body config lets the actual file bytes
// through instead of getting silently truncated or rejected.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

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

  const contentType = req.headers['content-type'] || '';
  if (!ALLOWED_TYPES.has(contentType)) {
    return res.status(400).json({ error: `Unsupported file type "${contentType}" — use PNG, JPEG, WebP, or GIF.` });
  }

  try {
    const buffer = await readRawBody(req);
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Empty file.' });
    }

    const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
    const filename = `token-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

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
    return res.status(500).json({ error: error.message || 'Upload failed' });
  }
};

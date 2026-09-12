const { createPublicClient, http, verifyMessage } = require('viem');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
};

const TOKEN_ABI = [
  { type: 'function', name: 'creator', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
];

// Cosmetic-only metadata (description, socials, image) for launched
// tokens — never touches the contract. Purely additive: if this store is
// empty or unreachable, the launch/buy/lock flow is completely
// unaffected, tokens just render without the extra details.
//
// Requires UPSTASH_REDIS_REST_URL/TOKEN (same database already used by
// circle-wallet.js). Writes also require a wallet signature proving the
// caller controls the token's on-chain creator() address — without that,
// anyone could overwrite any token's public description.
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

const MAX_DESCRIPTION = 280;
const MAX_HANDLE = 60;
const MAX_IMAGE_URL = 500;

let saveRatelimit = null;
if (redis) {
  saveRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '3600 s'), prefix: 'ratelimit:token-meta-save' });
}

function isAddress(a) {
  return typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);
}

function metadataMessage(token) {
  // Tied to the specific token address so a signature for one token can
  // never be replayed to set metadata on a different one.
  return `Set FlowFi token metadata for ${token.toLowerCase()}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action } = req.body;

    // ---- Fetch metadata for one or more tokens (public, no auth) ----
    // Body: { action: "getMany", tokens: string[] }
    if (action === 'getMany') {
      const tokens = Array.isArray(req.body.tokens) ? req.body.tokens.filter(isAddress) : [];
      if (tokens.length === 0 || tokens.length > 50) {
        return res.status(400).json({ error: 'Provide 1-50 token addresses.' });
      }
      if (!redis) {
        return res.status(200).json({ success: true, metadata: {} }); // degrade gracefully — no metadata, not an error
      }
      const keys = tokens.map((t) => `token-meta:${t.toLowerCase()}`);
      const values = await redis.mget(...keys);
      const metadata = {};
      tokens.forEach((t, i) => {
        const raw = values[i];
        if (!raw) return;
        try {
          metadata[t.toLowerCase()] = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { /* skip corrupt entry */ }
      });
      return res.status(200).json({ success: true, metadata });
    }

    // ---- Save metadata for a token (requires proof of ownership) ----
    // Body: { action: "save", token, creator, signature, description?, xHandle?, telegram?, imageUrl? }
    if (action === 'save') {
      const { token, creator, signature, description, xHandle, telegram, imageUrl } = req.body;
      if (!isAddress(token) || !isAddress(creator) || typeof signature !== 'string') {
        return res.status(400).json({ error: 'token, creator, and signature are required.' });
      }
      if (!redis) {
        return res.status(500).json({ error: 'Server misconfigured: this requires Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN).' });
      }
      if (saveRatelimit) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const { success } = await saveRatelimit.limit(ip);
        if (!success) {
          return res.status(429).json({ error: 'Too many metadata updates — please wait a bit and try again.' });
        }
      }
      if (description && description.length > MAX_DESCRIPTION) {
        return res.status(400).json({ error: `description must be ${MAX_DESCRIPTION} characters or fewer.` });
      }
      if ((xHandle && xHandle.length > MAX_HANDLE) || (telegram && telegram.length > MAX_HANDLE)) {
        return res.status(400).json({ error: `xHandle/telegram must be ${MAX_HANDLE} characters or fewer.` });
      }
      if (imageUrl && (imageUrl.length > MAX_IMAGE_URL || !/^https:\/\//.test(imageUrl))) {
        return res.status(400).json({ error: 'imageUrl must be a valid https:// URL.' });
      }

      // 1. The signature proves the caller controls `creator`.
      const valid = await verifyMessage({ address: creator, message: metadataMessage(token), signature });
      if (!valid) {
        return res.status(401).json({ error: 'Signature does not match the provided creator address.' });
      }

      // 2. `creator` must actually BE this token's creator on-chain — step
      // 1 alone only proves who signed, not that they own this specific
      // token. Without this check, anyone could sign with their own
      // wallet and claim any token address as theirs.
      let onChainCreator;
      try {
        onChainCreator = await publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'creator' });
      } catch {
        return res.status(400).json({ error: 'Could not verify this token on-chain.' });
      }
      if (onChainCreator.toLowerCase() !== creator.toLowerCase()) {
        return res.status(403).json({ error: 'This wallet is not the creator of this token.' });
      }

      const record = {
        description: description ? String(description).slice(0, MAX_DESCRIPTION) : '',
        xHandle: xHandle ? String(xHandle).slice(0, MAX_HANDLE) : '',
        telegram: telegram ? String(telegram).slice(0, MAX_HANDLE) : '',
        imageUrl: imageUrl ? String(imageUrl).slice(0, MAX_IMAGE_URL) : '',
        updatedAt: Date.now(),
      };
      await redis.set(`token-meta:${token.toLowerCase()}`, JSON.stringify(record));

      return res.status(200).json({ success: true, metadata: record });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Token metadata error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};

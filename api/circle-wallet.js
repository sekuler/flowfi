const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const BRIDGE_CHAINS = ['ARC-TESTNET', 'ETH-SEPOLIA', 'BASE-SEPOLIA', 'ARB-SEPOLIA'];

// Every contract + function FlowFi's Circle Wallet integration is ever
// meant to call, checked before any contractCall is forwarded to Circle.
// This is stricter than an address-only allowlist: a leaked/enumerated
// walletId still can't be used to call an unexpected function on an
// otherwise-trusted contract (e.g. transfer() on a token where only
// approve() should ever be reachable through this endpoint). Audited
// against every circleContractCallAndWait(...) call site in src/ — this
// list is exactly what's reachable today, nothing more.
// Addresses are compared case-insensitively; keys stored lowercase.
const ALLOWED_CALLS = new Map([
  // USDC, per chain — approve() feeds the pool/bridge/gateway contracts
  // below, transfer() is used by SendForm for direct sends.
  ['0x3600000000000000000000000000000000000000', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Arc Testnet USDC
  ['0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Ethereum Sepolia USDC
  ['0x036cbd53842c5426634e7929541ec2318f3dcf7e', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Base Sepolia USDC
  ['0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Arbitrum Sepolia USDC
  // EURC (Arc)
  ['0x89b50855aa3be2f677cd6303cec089b5f319d72a', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])],
  // ArcFactoryV2 v4c pool (USDC/EURC) — the only pool SwapForm's Circle
  // Wallet path actually calls (contractAddress: POOL_ADDRESS). If a new
  // curated pool goes live, its address needs adding here too, or Circle
  // Wallet swaps against it will 403.
  ['0x3f0b83e551e272181e2a42144bb07e68d14bd497', new Set(['swap(bool,uint256,uint256,uint256)'])],
  // Circle CCTP V2 (same address on every supported chain)
  ['0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', new Set(['depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)'])], // TokenMessengerV2
  ['0xe737e5cebeeba77efe34d4aa090756590b1ce275', new Set(['receiveMessage(bytes,bytes)'])], // MessageTransmitterV2
  // Circle Gateway (same address on every supported chain)
  ['0x0077777d7eba4688bdef3e311b846f25870a19b9', new Set(['deposit(address,uint256)'])], // Gateway Wallet
  ['0x0022222abe238cc2c7bb1f21003f0a260052475b', new Set(['gatewayMint(bytes,bytes)'])], // Gateway Minter
  // NOTE: the old Token Factory (0x481E8919...) is intentionally not
  // listed — TokenLaunch.tsx only ever executes via a connected browser
  // wallet (viem's custom(provider) transport), never through Circle
  // Wallet, so it was never actually reachable through this endpoint.
  // ArcSwap v5, ArcFactoryV2 v2/v3, and ArcEscrow v4 are likewise not
  // listed for the same reason: nothing in src/ calls them through
  // circleContractCallAndWait today. Add an entry here (with the exact
  // function signature) the day something actually needs to.
]);

// ---- Email-based identity layer ----
// Wallets are no longer created anonymously with no ownership check. A
// user proves control of an email address (via a one-time code) before a
// wallet is created for, or reattached to, them. This is what replaced
// the old "browse every wallet ever created and pick one" restore flow —
// a wallet can only ever be reached again through the same verified
// email, never by knowing/guessing a walletId.
//
// Requires UPSTASH_REDIS_REST_URL/TOKEN. Unlike the plain per-IP rate
// limiting used elsewhere in this file (which degrades gracefully to "off"
// if unset), this is identity infrastructure — the OTP store and the
// email→wallet mapping both live here — so these actions fail loudly
// (500) rather than silently skipping auth. Also requires
// WALLET_AUTH_SECRET (any long random string, used to sign session
// tokens) and RESEND_API_KEY (to actually send the code).
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const OTP_TTL_SECONDS = 600; // 10 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Session token = base64url(email + "." + expiryMs) + "." + HMAC-SHA256(that
// payload). Stateless — anyone holding WALLET_AUTH_SECRET can verify it
// with no DB lookup, but forging one without the secret is infeasible.
// verifySessionToken() also checks the token's email matches the email the
// caller is claiming, so a token can't be replayed against a different
// account even if somehow intercepted.
function issueSessionToken(email) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${email}.${expiry}`;
  const sig = crypto.createHmac('sha256', process.env.WALLET_AUTH_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifySessionToken(token, expectedEmail) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const dot = token.lastIndexOf('.');
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString();
  } catch {
    return false;
  }
  const expectedSig = crypto.createHmac('sha256', process.env.WALLET_AUTH_SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  const [tokenEmail, expiryStr] = payload.split('.');
  if (tokenEmail !== expectedEmail) return false;
  if (Date.now() > Number(expiryStr)) return false;
  return true;
}

async function sendVerificationEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Server misconfigured: RESEND_API_KEY not set');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'FlowFi <onboarding@resend.dev>',
      to: email,
      subject: `${code} is your FlowFi verification code`,
      html: `<p>Your FlowFi verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to send verification email (${response.status}): ${body}`);
  }
}

let otpRatelimit = null;
let verifyRatelimit = null;
if (redis) {
  // 5 code *requests* per email/IP per hour — this sends a real email each time.
  otpRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '3600 s'), prefix: 'ratelimit:circle-otp-request' });
  // 10 verify *attempts* per email per 10 minutes — a 6-digit code has only
  // 1,000,000 combinations, so this needs its own (tighter, time-boxed) limit
  // separate from the request limit above, or it could be brute-forced
  // within the OTP's 10-minute lifetime.
  verifyRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '600 s'), prefix: 'ratelimit:circle-otp-verify' });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    const { action } = req.body;

    // ---- Step 1: request a one-time code by email ----
    // Body: { action: "requestCode", email }
    if (action === 'requestCode') {
      const normEmail = normalizeEmail(req.body.email);
      if (!isValidEmail(normEmail)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }
      if (!redis) {
        return res.status(500).json({ error: 'Server misconfigured: this requires Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN).' });
      }

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
      if (otpRatelimit) {
        const [byEmail, byIp] = await Promise.all([
          otpRatelimit.limit(`email:${normEmail}`),
          otpRatelimit.limit(`ip:${ip}`),
        ]);
        if (!byEmail.success || !byIp.success) {
          return res.status(429).json({ error: 'Too many code requests — please wait a bit and try again.' });
        }
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await redis.set(`circle-otp:${normEmail}`, code, { ex: OTP_TTL_SECONDS });
      await sendVerificationEmail(normEmail, code);

      return res.status(200).json({ success: true });
    }

    // ---- Step 2: verify the code, create-or-reattach the wallet, issue a session ----
    // Body: { action: "verifyCode", email, code }
    if (action === 'verifyCode') {
      const normEmail = normalizeEmail(req.body.email);
      const code = String(req.body.code || '').trim();
      if (!isValidEmail(normEmail) || !code) {
        return res.status(400).json({ error: 'email and code are required.' });
      }
      if (!redis) {
        return res.status(500).json({ error: 'Server misconfigured: this requires Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN).' });
      }

      if (verifyRatelimit) {
        const { success } = await verifyRatelimit.limit(normEmail);
        if (!success) {
          return res.status(429).json({ error: 'Too many attempts — please request a new code.' });
        }
      }

      const storedCode = await redis.get(`circle-otp:${normEmail}`);
      if (!storedCode || String(storedCode) !== code) {
        return res.status(401).json({ error: 'Invalid or expired code.' });
      }
      await redis.del(`circle-otp:${normEmail}`);

      let walletRecord;
      const existing = await redis.get(`circle-wallet:${normEmail}`);
      if (existing) {
        walletRecord = typeof existing === 'string' ? JSON.parse(existing) : existing;
      } else {
        // First time this email has ever verified — provision a real
        // wallet set for it now (same Circle calls the old 'create'
        // action used to make directly, no ownership check).
        const walletSetResponse = await client.createWalletSet({ name: 'FlowFi WalletSet ' + Date.now() });
        const walletSetId = walletSetResponse.data?.walletSet?.id;
        const walletsResponse = await client.createWallets({ blockchains: BRIDGE_CHAINS, count: 1, walletSetId });
        const wallets = walletsResponse.data?.wallets ?? [];
        const walletsByChain = {};
        for (const w of wallets) walletsByChain[w.blockchain] = { walletId: w.id, address: w.address };
        walletRecord = { address: wallets[0]?.address ?? null, walletsByChain };
        await redis.set(`circle-wallet:${normEmail}`, JSON.stringify(walletRecord));
      }

      const token = issueSessionToken(normEmail);
      return res.status(200).json({
        success: true,
        address: walletRecord.address,
        walletsByChain: walletRecord.walletsByChain,
        email: normEmail,
        token,
      });
    }

    // ---- Execute a contract call (approve, swap, bridge burn/mint, transfer, etc.) ----
    // Body: { action: "contractCall", email, token, walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel? }
    if (action === 'contractCall') {
      const { email, token, walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel } = req.body;
      const normEmail = normalizeEmail(email);

      if (!redis) {
        return res.status(500).json({ error: 'Server misconfigured: this requires Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN).' });
      }
      if (!verifySessionToken(token, normEmail)) {
        return res.status(401).json({ error: 'Session expired or invalid. Please sign in again with your email.' });
      }
      if (!walletId || !contractAddress || !abiFunctionSignature) {
        return res.status(400).json({ error: 'walletId, contractAddress, and abiFunctionSignature are required.' });
      }

      const allowedFunctions = ALLOWED_CALLS.get(String(contractAddress).toLowerCase());
      if (!allowedFunctions || !allowedFunctions.has(abiFunctionSignature)) {
        return res.status(403).json({ error: 'This contract/function is not on FlowFi\'s allowlist for Circle Wallet execution.' });
      }

      // A valid session proves *an* email, but walletId is still
      // client-supplied — confirm this specific walletId actually belongs
      // to that email's own wallet record before forwarding to Circle.
      const stored = await redis.get(`circle-wallet:${normEmail}`);
      const walletRecord = typeof stored === 'string' ? JSON.parse(stored) : stored;
      const ownedWalletIds = walletRecord ? Object.values(walletRecord.walletsByChain).map((w) => w.walletId) : [];
      if (!ownedWalletIds.includes(walletId)) {
        return res.status(403).json({ error: 'This wallet does not belong to the signed-in account.' });
      }

      const response = await client.createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: abiParameters || [],
        fee: { type: 'level', config: { feeLevel: feeLevel || 'MEDIUM' } },
      });

      return res.status(200).json({
        success: true,
        transactionId: response.data?.id,
        state: response.data?.state,
      });
    }

    // ---- Poll a transaction's status until it's mined ----
    // Body: { action: "getTransaction", email, token, transactionId }
    if (action === 'getTransaction') {
      const { email, token, transactionId } = req.body;
      const normEmail = normalizeEmail(email);
      if (!verifySessionToken(token, normEmail)) {
        return res.status(401).json({ error: 'Session expired or invalid. Please sign in again with your email.' });
      }
      if (!transactionId) {
        return res.status(400).json({ error: 'transactionId is required.' });
      }

      const response = await client.getTransaction({ id: transactionId });
      const tx = response.data?.transaction;

      return res.status(200).json({
        success: true,
        state: tx?.state,
        txHash: tx?.txHash,
        errorReason: tx?.errorReason,
      });
    }

    // ---- Sign EIP-712 typed data (e.g. a Circle Gateway burn intent) ----
    // Body: { action: "signTypedData", email, token, walletId, data }
    // `data` must be the full { domain, types, primaryType, message } object —
    // it's JSON.stringify'd here since Circle's API expects a JSON string, not
    // a raw object. entitySecretCiphertext is generated fresh by the SDK
    // internally, same as every other authenticated call on this client.
    if (action === 'signTypedData') {
      const { email, token, walletId, data } = req.body;
      const normEmail = normalizeEmail(email);

      if (!redis) {
        return res.status(500).json({ error: 'Server misconfigured: this requires Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN).' });
      }
      if (!verifySessionToken(token, normEmail)) {
        return res.status(401).json({ error: 'Session expired or invalid. Please sign in again with your email.' });
      }
      if (!walletId || !data) {
        return res.status(400).json({ error: 'walletId and data are required.' });
      }

      const stored = await redis.get(`circle-wallet:${normEmail}`);
      const walletRecord = typeof stored === 'string' ? JSON.parse(stored) : stored;
      const ownedWalletIds = walletRecord ? Object.values(walletRecord.walletsByChain).map((w) => w.walletId) : [];
      if (!ownedWalletIds.includes(walletId)) {
        return res.status(403).json({ error: 'This wallet does not belong to the signed-in account.' });
      }

      const response = await client.signTypedData({
        walletId,
        data: JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
      });

      return res.status(200).json({
        success: true,
        signature: response.data?.signature,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Circle wallet error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};

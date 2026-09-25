// Mainnet Circle Developer-Controlled Wallets backend. Deliberately a SEPARATE file from
// api/circle-wallet.js (testnet): its own LIVE API key + entity secret, its own Redis keys,
// its own session cookie. Circle's TEST and LIVE keys can't be mixed in one call, and keeping
// them apart means nothing here can ever touch a testnet wallet (or vice versa).
//
// Safeguards agreed for mainnet (real funds):
//  1. Email verification before a wallet is created (same OTP flow as testnet).
//  2. A per-account cap (CIRCLE_LIVE_CAP_USD, default 100) on stablecoins held across all of
//     the account's wallets. Incoming transfers can't be blocked on-chain, so the cap is
//     enforced on ACTIONS: while over the cap, every action except `withdraw` is refused.
//  3. `withdraw` always works (cap or not): it sends a token from the Circle wallet to an
//     external address the user chooses, so funds can always be taken out, including on the
//     day this feature is switched off (set CIRCLE_LIVE_WITHDRAW_ONLY=1 to allow only that).
//
// Env: CIRCLE_LIVE_API_KEY (full "LIVE_API_KEY:..." string), CIRCLE_LIVE_ENTITY_SECRET,
// UPSTASH_REDIS_REST_URL/TOKEN, WALLET_AUTH_SECRET, RESEND_API_KEY (+ optional
// RESEND_FROM_EMAIL), optional CIRCLE_LIVE_CAP_USD, CIRCLE_LIVE_CHAINS, CIRCLE_LIVE_WITHDRAW_ONLY.
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const CHAINS = (process.env.CIRCLE_LIVE_CHAINS || 'ARC,BASE,ETH,ARB').split(',').map((s) => s.trim()).filter(Boolean);
const CAP_USD = Number(process.env.CIRCLE_LIVE_CAP_USD || 100);
const WITHDRAW_ONLY = process.env.CIRCLE_LIVE_WITHDRAW_ONLY === '1';

// Stablecoins counted toward the cap (1 unit ~ $1; EURC is counted 1:1, slightly
// conservative-low, which is fine for a safety cap of this size). cirBTC is counted too, at the
// live BTC price (see capStatus).
const CAP_SYMBOLS = new Set(['USDC', 'EURC']);

// Mainnet tokens a user may withdraw, per Circle chain code. Addresses lowercase.
// Arc: USDC system contract, EURC and cirBTC per Circle's official address pages.
const WITHDRAWABLE = {
  ARC: new Set([
    '0x3600000000000000000000000000000000000000', // USDC
    '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1', // EURC
    '0x171a4217b86a807a64eb94757db6849fb4bdbaa0', // cirBTC
  ]),
  BASE: new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']), // USDC
  ETH: new Set(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']), // USDC
  ARB: new Set(['0xaf88d065e77c8cc2239327c5edb3a432268e5831']), // USDC
};

// Contract calls allowed through `contractCall` (mainnet only). Token transfer() is NOT here:
// moving funds out goes through `withdraw` only, so it can be exempt from the cap and audited
// separately.
// Circle Gateway mainnet (same address on every chain), per
// developers.circle.com/gateway/references/contract-addresses. API: gateway-api.circle.com.
const GATEWAY_WALLET = '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee';
const GATEWAY_MINTER = '0x2222222d7164433c4c09b0b0d809a9b52c04c205';
const GATEWAY_API = 'https://gateway-api.circle.com';
const GATEWAY_DOMAIN_BY_CHAIN = { ARC: 26, BASE: 6, ETH: 0, ARB: 3 };

const USDC_APPROVE = new Set(['approve(address,uint256)']);
const ALLOWED_CALLS = new Map([
  ['0x3600000000000000000000000000000000000000', USDC_APPROVE], // Arc USDC
  ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', USDC_APPROVE], // Base USDC
  ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', USDC_APPROVE], // Ethereum USDC
  ['0xaf88d065e77c8cc2239327c5edb3a432268e5831', USDC_APPROVE], // Arbitrum USDC
  // Circle CCTP V2 mainnet (same address on every chain; matches NativeCctpBridge.tsx)
  ['0x28b5a0e9c621a5badaa536219b3a228c8168cf5d', new Set([
    'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
    'depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)',
  ])],
  ['0x81d40f21f12a8f0e3252bccb954d722d4c464b64', new Set(['receiveMessage(bytes,bytes)'])],
  // Circle Gateway: deposit USDC into the unified balance. Transfers out of Gateway are
  // signed burn intents (see `gatewaySign`), and minted on the destination by Circle's
  // Forwarding Service, so gatewayMint never has to run from these wallets.
  [GATEWAY_WALLET, new Set(['deposit(address,uint256)'])],
]);

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const OTP_TTL_SECONDS = 600;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_NAME = 'flowfi_circle_live_session';
const KEY = { otp: (e) => `circle-live-otp:${e}`, wallet: (e) => `circle-live-wallet:${e}` };

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isAddress(a) { return /^0x[0-9a-fA-F]{40}$/.test(String(a || '')); }

function cookieAttrs(maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function setSessionCookie(res, token) { res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}${cookieAttrs(Math.floor(SESSION_TTL_MS / 1000))}`); }
function clearSessionCookie(res) { res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${cookieAttrs(0)}`); }
function parseCookies(req) {
  const out = {};
  for (const pair of (req.headers.cookie || '').split(';')) {
    const i = pair.indexOf('=');
    if (i === -1) continue;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}

// Same HMAC session scheme as testnet, but the signed payload is prefixed with "live|" so a
// testnet session token can never be replayed against this mainnet endpoint.
function issueSessionToken(email) {
  const payload = `live|${email}.${Date.now() + SESSION_TTL_MS}`;
  const sig = crypto.createHmac('sha256', process.env.WALLET_AUTH_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}
function sessionEmail(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token || !token.includes('.')) return null;
  const dot = token.lastIndexOf('.');
  let payload;
  try { payload = Buffer.from(token.slice(0, dot), 'base64url').toString(); } catch { return null; }
  const expected = crypto.createHmac('sha256', process.env.WALLET_AUTH_SECRET).update(payload).digest('hex');
  const a = Buffer.from(token.slice(dot + 1), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!payload.startsWith('live|')) return null;
  const body = payload.slice(5);
  const p = body.lastIndexOf('.');
  if (p === -1 || Date.now() > Number(body.slice(p + 1))) return null;
  return body.slice(0, p);
}

async function sendVerificationEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Server misconfigured: RESEND_API_KEY not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'FlowFi <onboarding@resend.dev>',
      to: email,
      subject: `${code} is your FlowFi verification code`,
      html: `<p>Your FlowFi verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!r.ok) throw new Error(`Failed to send verification email (${r.status})`);
}

let otpRatelimit = null;
let verifyRatelimit = null;
let actionRatelimit = null;
if (redis) {
  otpRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '3600 s'), prefix: 'ratelimit:circle-live-otp-request' });
  verifyRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '600 s'), prefix: 'ratelimit:circle-live-otp-verify' });
  actionRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '600 s'), prefix: 'ratelimit:circle-live-action' });
}

async function loadRecord(email) {
  const stored = await redis.get(KEY.wallet(email));
  if (!stored) return null;
  return typeof stored === 'string' ? JSON.parse(stored) : stored;
}
function ownsWallet(record, walletId) {
  return !!record && Object.values(record.walletsByChain).some((w) => w.walletId === walletId);
}
function chainOfWallet(record, walletId) {
  const hit = Object.entries(record.walletsByChain).find(([, w]) => w.walletId === walletId);
  return hit ? hit[0] : null;
}

// Live BTC/USD price for valuing cirBTC against the cap. Two public sources, short timeout,
// cached for a minute. Returns null if both fail (callers then treat cirBTC as unpriceable).
let btcCache = { price: null, at: 0 };
async function btcPrice() {
  if (btcCache.price && Date.now() - btcCache.at < 60000) return btcCache.price;
  const tries = [
    async () => Number((await (await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(4000) })).json())?.data?.amount),
    async () => Number((await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { signal: AbortSignal.timeout(4000) })).json())?.bitcoin?.usd),
  ];
  for (const t of tries) {
    try { const p = await t(); if (Number.isFinite(p) && p > 1000) { btcCache = { price: p, at: Date.now() }; return p; } } catch { /* next source */ }
  }
  return null;
}

// USD value held by the account for the cap: USDC + EURC (1:1) + cirBTC at the live BTC price,
// across every wallet, plus the account's Gateway USDC balance. Uses Circle's own balance API.
// priceOk is false when the account holds cirBTC but no BTC price could be fetched.
async function capStatus(client, record) {
  let total = 0;
  let cirbtc = 0;
  for (const w of Object.values(record.walletsByChain)) {
    try {
      const r = await client.getWalletTokenBalance({ id: w.walletId });
      for (const tb of r.data?.tokenBalances ?? []) {
        if (tb?.token?.isNative) continue; // Arc lists USDC twice (native + ERC-20); count the ERC-20 once
        const sym = String(tb?.token?.symbol || '').toUpperCase();
        if (CAP_SYMBOLS.has(sym)) total += Number(tb.amount) || 0;
        else if (sym === 'CIRBTC') cirbtc += Number(tb.amount) || 0;
      }
    } catch { /* a chain that fails to report doesn't lower the total */ }
  }
  try {
    const sources = Object.entries(record.walletsByChain)
      .filter(([chain]) => GATEWAY_DOMAIN_BY_CHAIN[chain] !== undefined)
      .map(([chain, w]) => ({ domain: GATEWAY_DOMAIN_BY_CHAIN[chain], depositor: w.address }));
    if (sources.length) {
      const r = await fetch(`${GATEWAY_API}/v1/balances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'USDC', sources }) });
      if (r.ok) {
        const d = await r.json();
        for (const b of d?.balances ?? []) total += Number(b.balance) || 0;
      }
    }
  } catch { /* Gateway unreachable: wallet balances still count */ }
  let price = null;
  if (cirbtc > 0) {
    price = await btcPrice();
    if (price) total += cirbtc * price;
  } else {
    price = await btcPrice(); // still returned so the UI can size cirBTC deposits
  }
  return { total, btcPrice: price, priceOk: cirbtc === 0 || !!price };
}

function toBytes32(addr) { return `0x${'0'.repeat(24)}${String(addr).slice(2).toLowerCase()}`; }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!redis) return res.status(500).json({ error: 'Server misconfigured: Upstash Redis is required.' });
  if (!process.env.CIRCLE_LIVE_API_KEY || !process.env.CIRCLE_LIVE_ENTITY_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: Circle live credentials are not set.' });
  }

  try {
    // Tolerate common copy/paste mistakes in the Vercel values: surrounding quotes/spaces, a key
    // saved without its "LIVE_API_KEY:" prefix, or a secret pasted together with a label.
    const clean = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
    const rawKey = clean(process.env.CIRCLE_LIVE_API_KEY);
    const liveKey = rawKey.split(':').length === 2 ? `LIVE_API_KEY:${rawKey}` : rawKey;
    const entitySecret = (clean(process.env.CIRCLE_LIVE_ENTITY_SECRET).match(/[0-9a-fA-F]{64}/) || [''])[0];
    if (!liveKey.startsWith('LIVE_API_KEY:') || liveKey.split(':').length !== 3 || !entitySecret) {
      return res.status(500).json({ error: 'Server misconfigured: Circle live credentials look malformed.' });
    }
    const client = initiateDeveloperControlledWalletsClient({ apiKey: liveKey, entitySecret });
    const { action } = req.body || {};
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

    if (action === 'requestCode') {
      if (WITHDRAW_ONLY) return res.status(403).json({ error: 'New sign-ups are closed. Existing users can still sign in to withdraw.' });
      const email = normalizeEmail(req.body.email);
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required.' });
      const [byEmail, byIp] = await Promise.all([otpRatelimit.limit(`email:${email}`), otpRatelimit.limit(`ip:${ip}`)]);
      if (!byEmail.success || !byIp.success) return res.status(429).json({ error: 'Too many code requests. Please wait a bit and try again.' });
      const code = String(crypto.randomInt(100000, 1000000));
      await redis.set(KEY.otp(email), code, { ex: OTP_TTL_SECONDS });
      await sendVerificationEmail(email, code);
      return res.status(200).json({ success: true });
    }

    if (action === 'verifyCode') {
      const email = normalizeEmail(req.body.email);
      const code = String(req.body.code || '').trim();
      if (!isValidEmail(email) || !code) return res.status(400).json({ error: 'email and code are required.' });
      const { success } = await verifyRatelimit.limit(email);
      if (!success) return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
      const stored = await redis.get(KEY.otp(email));
      if (!stored || String(stored) !== code) return res.status(401).json({ error: 'Invalid or expired code.' });
      await redis.del(KEY.otp(email));

      let record = await loadRecord(email);
      if (!record) {
        if (WITHDRAW_ONLY) return res.status(403).json({ error: 'New sign-ups are closed.' });
        const ws = await client.createWalletSet({ name: `FlowFi Live ${Date.now()}` });
        const walletSetId = ws.data?.walletSet?.id;
        const created = await client.createWallets({ blockchains: CHAINS, count: 1, walletSetId, accountType: 'EOA' });
        const walletsByChain = {};
        for (const w of created.data?.wallets ?? []) walletsByChain[w.blockchain] = { walletId: w.id, address: w.address };
        record = { address: created.data?.wallets?.[0]?.address ?? null, walletsByChain };
        await redis.set(KEY.wallet(email), JSON.stringify(record));
      }
      setSessionCookie(res, issueSessionToken(email));
      return res.status(200).json({ success: true, address: record.address, walletsByChain: record.walletsByChain, email, capUsd: CAP_USD, withdrawOnly: WITHDRAW_ONLY });
    }

    if (action === 'logout') {
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    // ---- everything below requires a valid mainnet session ----
    const email = sessionEmail(req);
    if (!email) return res.status(401).json({ error: 'Session expired or invalid. Please sign in again with your email.' });
    const { success: actionOk } = await actionRatelimit.limit(email);
    if (!actionOk) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    const record = await loadRecord(email);
    if (!record) return res.status(401).json({ error: 'No wallet for this account. Please sign in again.' });

    if (action === 'status') {
      const cap = await capStatus(client, record);
      return res.status(200).json({ success: true, stableTotal: cap.total, btcPrice: cap.btcPrice, priceOk: cap.priceOk, capUsd: CAP_USD, overCap: cap.total > CAP_USD, withdrawOnly: WITHDRAW_ONLY });
    }

    // Withdraw: always allowed. Sends `amount` of an allowlisted token to an external address.
    // Body: { action: "withdraw", walletId, tokenAddress, amount (decimal string), destinationAddress }
    if (action === 'withdraw') {
      const { walletId, tokenAddress, amount, destinationAddress } = req.body;
      if (!ownsWallet(record, walletId)) return res.status(403).json({ error: 'This wallet does not belong to the signed-in account.' });
      const chain = chainOfWallet(record, walletId);
      const token = String(tokenAddress || '').toLowerCase();
      if (!WITHDRAWABLE[chain]?.has(token)) return res.status(400).json({ error: 'This token cannot be withdrawn on this network.' });
      if (!isAddress(destinationAddress)) return res.status(400).json({ error: 'Enter a valid 0x wallet address.' });
      const own = Object.values(record.walletsByChain).map((w) => String(w.address).toLowerCase());
      if (own.includes(String(destinationAddress).toLowerCase())) return res.status(400).json({ error: 'Destination must be your own external wallet, not this Circle wallet.' });
      if (!/^\d+(\.\d+)?$/.test(String(amount || '')) || Number(amount) <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });

      const r = await client.createTransaction({
        walletId,
        blockchain: chain,
        tokenAddress: token,
        destinationAddress,
        amount: [String(amount)],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });
      return res.status(200).json({ success: true, transactionId: r.data?.id, state: r.data?.state });
    }

    // Sign a Circle Gateway burn intent (moves USDC out of this account's Gateway balance).
    // Like `withdraw`, it is always allowed (cap or withdraw-only), because it only moves funds
    // out of Gateway. Strictly limited to Gateway burn intents whose depositor AND signer are
    // this wallet and whose contracts are the real mainnet Gateway contracts, so it can never be
    // used to sign any other typed data.
    // Body: { action: "gatewaySign", walletId, data: { domain, types, primaryType, message } }
    if (action === 'gatewaySign') {
      const { walletId, data } = req.body;
      if (!ownsWallet(record, walletId)) return res.status(403).json({ error: 'This wallet does not belong to the signed-in account.' });
      const chain = chainOfWallet(record, walletId);
      const own = toBytes32(record.walletsByChain[chain].address);
      const spec = data?.message?.spec;
      const ok = data?.domain?.name === 'GatewayWallet' && String(data?.domain?.version) === '1'
        && data?.primaryType === 'BurnIntent' && spec
        && String(spec.sourceDepositor).toLowerCase() === own
        && String(spec.sourceSigner).toLowerCase() === own
        && String(spec.sourceContract).toLowerCase() === toBytes32(GATEWAY_WALLET)
        && String(spec.destinationContract).toLowerCase() === toBytes32(GATEWAY_MINTER)
        && Number(spec.sourceDomain) === GATEWAY_DOMAIN_BY_CHAIN[chain]
        && (spec.hookData === '0x' || spec.hookData === undefined);
      if (!ok) return res.status(403).json({ error: 'Only Gateway transfers from your own Circle Wallet can be signed.' });
      const r = await client.signTypedData({
        walletId,
        data: JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      });
      return res.status(200).json({ success: true, signature: r.data?.signature });
    }

    if (action === 'getTransaction') {
      const { transactionId } = req.body;
      if (!transactionId) return res.status(400).json({ error: 'transactionId is required.' });
      const r = await client.getTransaction({ id: transactionId });
      const tx = r.data?.transaction;
      if (!tx || !ownsWallet(record, tx.walletId)) return res.status(403).json({ error: 'This transaction does not belong to the signed-in account.' });
      return res.status(200).json({ success: true, state: tx.state, txHash: tx.txHash, errorReason: tx.errorReason });
    }

    if (action === 'contractCall') {
      if (WITHDRAW_ONLY) return res.status(403).json({ error: 'This feature is closing. Only withdrawals are available.' });
      const { walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel } = req.body;
      if (!walletId || !contractAddress || !abiFunctionSignature) return res.status(400).json({ error: 'walletId, contractAddress and abiFunctionSignature are required.' });
      const allowed = ALLOWED_CALLS.get(String(contractAddress).toLowerCase());
      if (!allowed || !allowed.has(abiFunctionSignature)) return res.status(403).json({ error: "This contract/function is not on FlowFi's mainnet allowlist." });
      if (!ownsWallet(record, walletId)) return res.status(403).json({ error: 'This wallet does not belong to the signed-in account.' });
      const cap = await capStatus(client, record);
      if (!cap.priceOk) return res.status(503).json({ error: "Couldn't price your cirBTC right now, so actions are paused for safety. Withdrawals still work. Please try again in a minute." });
      if (cap.total > CAP_USD) return res.status(403).json({ error: `Your Circle wallet holds more than the $${CAP_USD} limit. Please withdraw the excess to your own wallet first.` });
      const r = await client.createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: abiParameters || [],
        fee: { type: 'level', config: { feeLevel: feeLevel || 'MEDIUM' } },
      });
      return res.status(200).json({ success: true, transactionId: r.data?.id, state: r.data?.state });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Circle live wallet error:', error?.message);
    return res.status(500).json({ error: error?.message ?? 'Internal error' });
  }
};

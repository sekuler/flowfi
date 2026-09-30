# FlowFi Backend API

Internal reference for FlowFi's serverless backend endpoints (Vercel functions under `/api`). All secrets (Anthropic key, Circle key, DropsTab key) live server-side only — none of these are exposed to the browser.

---

## `GET /api/market-analysis`

Real-time market data and technical analysis for any coin, computed server-side from CoinGecko data. The numbers are pure data and math; a short AI-written summary (`insight`) is added on top.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `coinId` | Yes | CoinGecko coin id, e.g. `bitcoin`, `morpho` |

**Caching:** 90 seconds per coin (in-memory). Repeated requests for the same coin within that window return the cached result instantly, regardless of how many users ask.

**Rate limit:** 10 requests/minute per IP via Upstash Redis. `coinId` must be a CoinGecko-style id (lowercase letters, digits, dashes).

**Response shape:**
```json
{
  "coinId": "bitcoin",
  "assetType": "crypto_asset",
  "name": "Bitcoin",
  "symbol": "BTC",
  "price": 63590,
  "marketCap": 1267000000000,
  "volume24h": 21900000000,
  "change": { "h24": 1.04, "d7": -2.09, "d30": -0.61 },
  "supply": { "circulating": 20071453, "total": 20071453, "max": 21000000 },
  "timeframes": {
    "1H": { "rsi": 75.0, "structure": "downtrend", "candleCount": 168 },
    "4H": { "rsi": 69.7, "structure": "downtrend", "candleCount": 42 },
    "1D": { "rsi": 51.2, "structure": "downtrend", "candleCount": 181 },
    "1W": { "rsi": 29.4, "structure": "downtrend", "candleCount": 26 },
    "1M": null
  },
  "technicals": {
    "ema20": 64100.5,
    "ema50": 64500.2,
    "macd": { "value": -227.46, "signal": -112.33, "bullish": false }
  },
  "pivotLevels": { "r1": 65810, "r2": 68020, "r3": 69520, "pivot": 64100, "s1": 62090, "s2": 60590, "s3": 58370 },
  "fetchedAt": "2026-08-17T12:00:00Z",
  "cached": false
}
```

`assetType` is either `"crypto_asset"` (normal technical analysis applies) or `"stablecoin"` (detected via CoinGecko category tags or low 30-day volatility — the frontend renders a different, stability-focused view instead of RSI/MACD/support-resistance, which would be misleading for a pegged asset).

A `timeframes` entry is `null` when there isn't enough real historical data to compute it honestly (e.g. `1M` for most coins on the free tier) — never filled with a guess.

---

## `GET /api/dropstab`

Live token unlock/vesting data via the DropsTab Builders Program API.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `coinSlug` | Yes | Coin identifier — matched against DropsTab's own `coinSlug` or `coinSymbol` fields (not necessarily the same as a CoinGecko id) |

**How it works:** Our Builders Program tier only includes the general overview endpoint (`/tokenUnlocks`), not per-coin lookups. This endpoint fetches that overview in parallel batches of pages (up to ~101 pages) and searches for a match. No reliance on in-memory state persisting between requests — Vercel serverless instances aren't guaranteed to be warm/shared, so every request re-searches from scratch via parallel batches rather than a slow sequential crawl.

**Rate limit:** 10 requests/minute per IP, via Upstash Redis — shared across every serverless instance, not an in-memory approximation. Skipped entirely (not approximated) if `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't set.

**Response:** DropsTab's raw item for the matched coin (allocations array with `tokenUnlockProgress` per allocation), or a 404 if not found in their tracked list. Not every project — especially fully-vested ones — is tracked.

---

## `POST /api/claude`

Proxy for all Claude API calls. The Anthropic key lives only here (`ANTHROPIC_API_KEY` env var).

**Body:** `{ model, max_tokens, system, messages }` — same shape as calling Anthropic's `/v1/messages` directly, with limits: `model` must be on the allowlist, `max_tokens` ≤ 1000, `system` a string ≤ 8,000 chars, 1–4 messages with plain-string content ≤ 8,000 chars each, 16,000 chars in total. Only these fields are forwarded.

**Rate limit:** 20 requests/minute and 300 requests/day per IP, via Upstash Redis — shared across every serverless instance (not an in-memory per-instance approximation, which was never a real limit under concurrent traffic). Skipped entirely, not approximated, if `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't set. Protects the shared API credit balance from abuse, since every user's AI usage draws from the same key.

**Response:** Anthropic's raw response, passed through unmodified.

---

## `GET|POST /api/iris-proxy`

Generic proxy for Circle's IRIS API (`iris-api-sandbox.circle.com`) — attestation polling, CCTPx token lookup, CCTPx fast-transfer allowance, and the CCTPx fee quote. Exists because the CCTPx fee-quote endpoint rejects direct browser calls (CORS), so every IRIS call is routed server-side for consistency.

**GET params:** `path` — the absolute IRIS path to forward, URL-encoded (e.g. `/v2/messages/0?transactionHash=0x...`).

**POST body:** `{ path: string, body: object }` — `path` is the IRIS path, `body` is forwarded as the JSON request body.

**Response:** IRIS's raw response body and status code, passed through unmodified.

---

## `GET /api/arcscan-proxy`

Proxy for Arcscan's (Blockscout-style) explorer API — used for transaction history everywhere the app shows it (Home, Dashboard, History, Swap activity, etc.). Calling `testnet.arcscan.app/api` directly from the browser is unreliable (CORS), so this proxies it server-side.

**Query params:** `network=mainnet` routes to Etherscan's V2 API for Arc Mainnet (uses `ETHERSCAN_API_KEY`); otherwise testnet Arcscan. Only allowlisted queries pass: `module=account` with `txlist`, `tokentx`, `txlistinternal`, `balance`, `tokenbalance`, and `module=logs` with `getLogs`. Unknown params are dropped.

**Rate limit:** 60 requests/minute per IP. Successful responses are cached for 30 seconds in Upstash Redis.

**Response:** Arcscan's raw response body and status code, passed through unmodified.

---

## `POST /api/rpc-proxy`

JSON-RPC proxy for Arc Testnet, and Arc Mainnet with `?network=mainnet`. Two reasons this exists rather than calling an RPC directly from the browser: Arc's own public RPC (`rpc.testnet.arc.network`) doesn't return CORS headers, so direct browser calls to it fail; and a keyed provider (e.g. Alchemy) would otherwise require exposing that key in client-side source. This keeps any such key server-side only.

**Body:** a JSON-RPC 2.0 call or a batch of up to 64 calls. Methods must be on the allowlist in the file; `eth_getLogs` must be scoped to 1–5 contract addresses and explicit numeric ranges are capped at 100,000 blocks.

**Rate limit:** 300 calls/minute per IP (each call in a batch counts). Refuses to serve in production without Upstash Redis.

**Env vars:** `ARC_RPC_URL` (optional) — a keyed RPC provider URL. Falls back to the public `https://rpc.testnet.arc.network` if unset.

**Response:** the upstream RPC's raw response body and status code, passed through unmodified.

---

## `POST /api/circle-wallet`

Creates and operates Circle Developer-Controlled Wallets, and executes allowlisted contract calls on a wallet's behalf (used by the Circle Wallet path in Bridge, Swap, Gateway, and History).

**Body:** `{ action, ... }` — `action` is one of `create`, `contractCall`, or a balance/wallet lookup; remaining fields depend on the action.

**Security:** `contractCall` only accepts `contractAddress` values on an explicit allowlist (`ALLOWED_CONTRACTS` in the file) — USDC/EURC per chain, ArcSwap, CCTP's TokenMessengerV2/MessageTransmitterV2, and Circle Gateway's Wallet/Minter contracts. Any other address is rejected with a 403 before it reaches Circle's API. See [`SECURITY.md`](./SECURITY.md) for why this allowlist exists.

**Env vars:** `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`.

---

## `POST /api/circle-wallet-mainnet`

Mainnet Circle Wallet (LIVE key, separate from testnet). Email one-time code sign-in, httpOnly session cookie, a per-account holding cap, and a `withdraw` action that always works. See the file header for the full list of actions and env vars.

---

## `POST /api/upload-image`

Uploads a Token Launch image (Testnet) to Vercel Blob. PNG/JPEG/WebP/GIF up to 5 MB; the file's bytes must match its declared type. **Rate limit:** 5 uploads/hour per IP.

---

## Shared conventions

- All secrets are read from `process.env.*` with **no `VITE_` prefix** — Vite bundles `VITE_`-prefixed env vars into client-side JS, so anything with that prefix is effectively public. Server-only secrets must never use it.
- Endpoints backed by a shared, metered secret or storage (Claude, market analysis, DropsTab, explorer, RPC, uploads, Circle Wallet) apply a per-IP rate limit via Upstash Redis.
- Errors return a JSON body `{ error: string }` with an appropriate HTTP status — never a bare crash or an HTML error page.

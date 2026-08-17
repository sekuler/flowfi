# FlowFi Backend API

Internal reference for FlowFi's serverless backend endpoints (Vercel functions under `/api`). All secrets (Anthropic key, DropsTab key, Telegram bot token) live server-side only — none of these are exposed to the browser.

---

## `GET /api/market-analysis`

Real-time market data and technical analysis for any coin, computed server-side from CoinGecko data. No AI involved — pure data and math.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `coinId` | Yes | CoinGecko coin id, e.g. `bitcoin`, `morpho` |

**Caching:** 90 seconds per coin (in-memory). Repeated requests for the same coin within that window return the cached result instantly, regardless of how many users ask.

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

**Response:** DropsTab's raw item for the matched coin (allocations array with `tokenUnlockProgress` per allocation), or a 404 if not found in their tracked list. Not every project — especially fully-vested ones — is tracked.

---

## `POST /api/claude`

Proxy for all Claude API calls. The Anthropic key lives only here (`ANTHROPIC_API_KEY` env var).

**Body:** `{ model, max_tokens, system, messages }` — same shape as calling Anthropic's `/v1/messages` directly.

**Rate limit:** 8 requests/minute per IP (in-memory, best-effort) — protects the shared API credit balance from abuse, since every user's AI usage draws from the same key.

**Response:** Anthropic's raw response, passed through unmodified.

---

## `POST /api/feedback`

Sends in-app user feedback to a Telegram chat via the Bot API.

**Body:** `{ message: string, page?: string }`

**Env vars required:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

**Debug mode:** `GET /api/feedback?test=1` sends a test message and returns Telegram's raw response — useful for verifying the bot token/chat id are correctly configured without needing to trigger it from the UI.

---

## Shared conventions

- All secrets are read from `process.env.*` with **no `VITE_` prefix** — Vite bundles `VITE_`-prefixed env vars into client-side JS, so anything with that prefix is effectively public. Server-only secrets must never use it.
- All endpoints apply a basic per-IP rate limit where the underlying resource is a shared, metered secret (Claude, DropsTab).
- Errors return a JSON body `{ error: string }` with an appropriate HTTP status — never a bare crash or an HTML error page.

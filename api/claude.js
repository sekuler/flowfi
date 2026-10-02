// api/claude.js
//
// Proxy for all Claude API calls. The real Anthropic key lives ONLY here, as a server-side env var
// (ANTHROPIC_API_KEY, no VITE_ prefix so Vite never bundles it into client-side JS).
//
// The frontend no longer sends a system prompt, model or max_tokens. It sends only:
//   { task: "<one of TASKS below>", text: "<the user's message>", context?: { ...small, validated data } }
// and every prompt, model and token limit is fixed here on the server. Before this, any website or
// script could POST its own system prompt and use FlowFi's key as a free general-purpose LLM.
// The response is still Anthropic's raw shape ({ content: [{ text }] }), so callers read it the same way.
//
// Limits (Upstash Redis, shared across every serverless instance):
//  - per IP: 20 requests/minute and 300/day
//  - global: CLAUDE_GLOBAL_DAILY_LIMIT requests/day across all users (default 2000), a hard ceiling on
//    the daily bill even if many IPs are used.
// Production refuses to serve without Redis; local dev without it runs unprotected.

const { Ratelimit } = require("@upstash/ratelimit");
const { Redis } = require("@upstash/redis");

const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5";

const MAX_TEXT_CHARS = 1000;

// ---- small validators for `context` (everything that ends up inside a prompt) ----
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
const amountStr = (v) => { const n = num(v); return n === null ? "unknown" : String(n); };
const sym = (v) => (typeof v === "string" && /^[A-Za-z0-9]{1,12}$/.test(v) ? v : null);
const shortText = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// Recent transactions for the wallet assistant: at most 30, only these fields, each value short.
function cleanTxs(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).map((t) => ({
    hash: shortText(t?.hash, 70),
    method: shortText(t?.method, 12),
    timestamp: shortText(String(t?.timestamp ?? ""), 12),
    value: shortText(String(t?.value ?? ""), 40),
  }));
}

const NO_ADVICE = "Never recommend buying, selling, or holding anything. Always respond in the same language the user wrote in.";

// Every AI feature in the app. Each builds its own system prompt and user message from validated input.
const TASKS = {
  // Market analysis: which coin is the user asking about?
  "coin-detect": {
    model: HAIKU, max_tokens: 20,
    build: (text) => ({
      system: "The user's message may be in any language and may mention a cryptocurrency (by name or ticker, e.g. 'BTC', 'dogecoin', 'ETH'). Respond with ONLY the coin's common English name or ticker, nothing else, no punctuation, no explanation. If no specific coin is mentioned, respond with exactly: NONE",
      user: text,
    }),
  },

  // Mainnet Copilot: does the user want to bridge, swap, or neither? It never executes anything.
  "mainnet-intent": {
    model: HAIKU, max_tokens: 200,
    build: (text) => ({
      system: `You are FlowFi Copilot on the MAINNET side of the app (real funds). You do not execute anything yourself -- your only job is to recognize whether the user wants to (a) bridge/move USDC onto or off Arc mainnet from another chain, or (b) swap tokens on Arc mainnet itself, or (c) neither. Respond with STRICT JSON only, no markdown:
{"action": "bridge" | "swap" | "unknown", "summary": "one short plain-English sentence describing what they want, in the same language they wrote in"}
Use "bridge" for anything crossing chains (e.g. "bring my USDC from Base to Arc", "move 50 USDC to Arc"). Use "swap" for same-chain token exchange on Arc (e.g. "swap USDC for EURC on Arc"). Use "unknown" for anything else, including general questions -- do not force a bridge/swap interpretation onto unrelated requests.`,
      user: text,
    }),
  },

  // Mainnet Copilot: short general answer when the message isn't a bridge/swap request.
  "mainnet-general": {
    model: SONNET, max_tokens: 250,
    build: (text) => ({
      system: `You are FlowFi Copilot (Arc Mainnet). The user's message isn't a bridge/swap request and isn't about a specific coin -- answer briefly and factually. What FlowFi offers on Arc Mainnet: Bridge (USDC, EURC and cirBTC onto Arc via Circle CCTP, or any token via LI.FI), Swap (tokens on Arc via LI.FI), Earn & Borrow (deposit USDC or EURC into curated Morpho vaults; borrow USDC or EURC against cirBTC), Gateway (one USDC balance across Arc, Base, Ethereum and Arbitrum), and Dashboard/History. Every transaction is signed by the user's own browser wallet. Only describe features from this list. ${NO_ADVICE}`,
      user: text,
    }),
  },

  // Mainnet Home: questions about the user's own wallet, grounded in their balance + recent txs.
  "wallet-assistant": {
    model: SONNET, max_tokens: 300,
    build: (text, ctx) => ({
      system: `You are FlowFi's wallet assistant for Arc MAINNET (real funds). You are given the user's current USDC balance (${amountStr(ctx.usdc)}) and their recent raw transaction list (method IDs, timestamps, values) from Arc Mainnet. For questions about the user's wallet, answer grounded ONLY in the data given; if the data doesn't contain enough information, say so honestly rather than guessing. For questions about how to use FlowFi, explain briefly: USDC can be brought onto Arc from other chains on the Bridge page (via LI.FI or Circle's native CCTP), tokens on Arc can be swapped on the Swap page, USDC or EURC can earn yield on the Earn & Borrow page (Morpho vaults) or be borrowed against cirBTC there, and Gateway keeps one USDC balance across Arc, Base, Ethereum and Arbitrum. All of these are signed by the user's own browser wallet. Never give financial advice. Always respond in the same language the user's question is written in. Keep answers under 4 sentences.`,
      user: `Transaction data: ${JSON.stringify(cleanTxs(ctx.txs))}\n\nQuestion: ${text}`,
    }),
  },

  // Testnet Copilot: natural language -> one executable testnet action (as JSON).
  "testnet-command": {
    model: SONNET, max_tokens: 400,
    build: (text, ctx) => {
      const memory = shortText(ctx.memory, 600);
      return {
        system: `You are FlowFi Copilot, a DeFi command parser. Parse the user's natural-language request into STRICT JSON only, no markdown, no preamble.

Schema:
{
  "action": "swap" | "send" | "bridge" | "strategy" | "unknown",
  "fromToken": "USDC" | "EURC" (for swap — this is a fixed-rate USDC/EURC swap only, no other pair is executable here),
  "toToken": "USDC" | "EURC" (for swap — same restriction as fromToken),
  "amount": number (omit if useAllBalance is true),
  "useAllBalance": boolean (true if user says "all my X"),
  "recipient": string (address or .arc name, for send),
  "destinationChain": "Arc Testnet" | "Ethereum Sepolia" | "Base Sepolia" | "Arbitrum Sepolia" (ONLY for send, ONLY if the user names a specific chain the recipient should receive funds on, e.g. "send 50 USDC to 0xABC on Base" — omit entirely if no chain is mentioned, defaulting to a normal same-chain transfer on Arc),
  "allocations": [{ "category": "swap_to_eurc" | "idle", "amount": number, "percent": number, "note": "short reason for this allocation" }] (ONLY for action "strategy"),
  "followUp": { "action": "swap", "toToken": "EURC" } (ONLY for action "bridge", ONLY if the user's request has a clear second step after the bridge, e.g. "bridge 50 USDC to Arc and swap it to EURC" → followUp: {"action":"swap","toToken":"EURC"}. Omit entirely if the user only asked to bridge, with no stated next step.),
  "summary": "short one-line plain-English summary of what will happen",
  "reasoning": "one short sentence on any relevant risk or note"
}

Use "strategy" when the user describes a total amount and asks for a plan, allocation, or strategy (e.g. "I have 500 USDC, give me the safest strategy", "how should I split my USDC"). Allocations must sum to the user's stated amount and only use the two categories above — "swap_to_eurc" diversifies into EURC, "idle" is a deliberate cash reserve. Do not invent other categories (no lending, no LP, no perps) since those require extra parameters this schema doesn't support. A "safest" strategy should favor "idle" over "swap_to_eurc". Explain each allocation's purpose briefly in its "note".

Only USDC and EURC are swappable via this fixed-rate action. If the user asks to swap USYC, ARCC, cirBTC, or any other token, do NOT set fromToken/toToken to that token — set action to "unknown" and explain in summary that this pair isn't supported by the fixed-rate swap, and that they'd need an existing Liquidity Pool for that pair instead (Tools → Liquidity). If the request is otherwise ambiguous or ill-formed, also set action to "unknown" and explain in summary.

Interpret goal-oriented requests, not just literal commands. If the user states an outcome they want rather than a specific mechanism (e.g. "Get me 100 EURC on Arc", "I need 50 USDC", "top up my EURC"), figure out which single supported action gets them there and use that — you do not need the user to say the word "swap" or "bridge" explicitly. As a rule of thumb: wanting a different token they don't currently hold enough of, while already having USDC on Arc, means "swap"; wanting funds moved to a specific external address means "send" (with destinationChain if a chain is named); wanting USDC specifically on a different chain than Arc, with no recipient mentioned, means "bridge". Only fall back to "unknown" if the goal genuinely can't be reached with swap, send, bridge, or strategy.
Available user balances: USDC ${amountStr(ctx.usdc)}, EURC ${amountStr(ctx.eurc)}.
${memory ? `What you know about this user's real recent behavior, from their actual transaction history: ${memory} Use this naturally when relevant — for example, weight a "strategy" allocation toward what they already do, or mention it briefly in your reasoning if it's genuinely relevant. Never state this as a fact if it isn't directly implied by the note above, and never fabricate additional behavioral claims beyond it.` : ""}
The "summary" field must be written in the same language the user's message is written in — if they write in Turkish, write the summary in Turkish; if in English, write it in English.
Respond with ONLY the JSON object.`,
        user: text,
      };
    },
  },

  // Testnet Copilot: short general answer.
  "testnet-general": {
    model: SONNET, max_tokens: 250,
    build: (text) => ({
      system: `You are FlowFi Copilot. The user's message isn't a transaction command and isn't about a specific coin — answer briefly and factually. ${NO_ADVICE}`,
      user: text,
    }),
  },

  // Testnet Swap: risk note for a swap, built only from numbers. No free text from the client at all.
  "swap-advice": {
    model: SONNET, max_tokens: 150,
    needsText: false,
    build: (_text, ctx) => {
      const tokenIn = sym(ctx.tokenIn) ?? "token";
      const tokenOut = sym(ctx.tokenOut) ?? "token";
      return {
        system: "You are a swap risk advisor for a DeFi app. You are given real on-chain pool data. Write a 2-3 sentence recommendation in English, grounded ONLY in the numbers given. Never invent data not provided. Be direct and concrete. Explain briefly WHY you're giving this recommendation, referencing the specific pool impact percentage.",
        user: `Swap: ${amountStr(ctx.amountIn)} ${tokenIn} -> ${amountStr(ctx.amountOut)} ${tokenOut}. Pool liquidity available for ${tokenOut}: ${amountStr(ctx.poolOut)}. This swap would consume ${amountStr(ctx.impactPct)}% of that pool's liquidity. Remaining liquidity after swap: ${amountStr(ctx.remaining)}. Give your recommendation and briefly explain why.`,
      };
    },
  },
};

let ratelimit = null;
let dailyLimit = null;
let globalLimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, "60 s"), prefix: "ratelimit:claude" });
  dailyLimit = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(300, "86400 s"), prefix: "ratelimit:claude-daily" });
  const globalPerDay = Number(process.env.CLAUDE_GLOBAL_DAILY_LIMIT);
  globalLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(Number.isFinite(globalPerDay) && globalPerDay > 0 ? Math.floor(globalPerDay) : 2000, "86400 s"),
    prefix: "ratelimit:claude-global",
  });
} else if (process.env.NODE_ENV === "production") {
  console.error("api/claude.js: UPSTASH_REDIS_REST_URL/TOKEN not set in production — refusing to serve unprotected.");
} else {
  console.warn("api/claude.js: UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is OFF (dev only).");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!ratelimit && process.env.NODE_ENV === "production") {
    return res.status(503).json({ error: "Service temporarily unavailable — rate limiting is not configured." });
  }

  const { task: taskName, text, context } = req.body ?? {};
  const task = Object.prototype.hasOwnProperty.call(TASKS, taskName) ? TASKS[taskName] : null;
  if (!task) return res.status(400).json({ error: "Unknown AI task." });
  const userText = typeof text === "string" ? text.trim() : "";
  if (task.needsText !== false && !userText) return res.status(400).json({ error: "Please type a message." });
  if (userText.length > MAX_TEXT_CHARS) return res.status(400).json({ error: `Messages are limited to ${MAX_TEXT_CHARS} characters.` });
  const ctx = context && typeof context === "object" && !Array.isArray(context) ? context : {};

  if (ratelimit) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
    if (!(await ratelimit.limit(ip)).success) return res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
    if (!(await dailyLimit.limit(ip)).success) return res.status(429).json({ error: "Daily AI limit reached. Please try again tomorrow." });
    if (!(await globalLimit.limit("all")).success) return res.status(429).json({ error: "The AI assistant is busy today. Please try again tomorrow." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" });

  try {
    const { system, user } = task.build(userText, ctx);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: task.model, max_tokens: task.max_tokens, system, messages: [{ role: "user", content: user }] }),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("api/claude.js error:", err?.message);
    return res.status(500).json({ error: "AI service error. Please try again." });
  }
};

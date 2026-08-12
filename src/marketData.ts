// Client-side glue: resolves whatever coin the user mentions (any language),
// calls our own /api/market-analysis backend (which does all the real math
// server-side, cached), then formats a clean report. The AI is only asked
// for a short interpretive paragraph — it must not restate numbers that are
// already shown deterministically above it.

import { getTokenUnlockInfo } from "./tokenUnlocks";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}

function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  return `$${n.toFixed(n < 1 ? 6 : 2)}`;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function trendLabel(structure: string | undefined): string {
  if (structure === "uptrend") return "Uptrend";
  if (structure === "downtrend") return "Downtrend";
  if (structure === "consolidating") return "Consolidating";
  return "Limited data";
}

function trendDot(structure: string | undefined): string {
  if (structure === "uptrend") return "🟢";
  if (structure === "downtrend") return "🔴";
  if (structure === "consolidating") return "🟡";
  return "⚪";
}

async function extractCoinQuery(question: string): Promise<string | null> {
  try {
    const apiKey = (import.meta as any).env.VITE_ANTHROPIC_KEY;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 20,
        system: "The user's message may be in any language and may mention a cryptocurrency (by name or ticker, e.g. 'BTC', 'dogecoin', 'ETH'). Respond with ONLY the coin's common English name or ticker, nothing else, no punctuation, no explanation. If no specific coin is mentioned, respond with exactly: NONE",
        messages: [{ role: "user", content: question }],
      }),
    });
    const data = await res.json();
    const text: string = (data.content?.[0]?.text ?? "").trim();
    if (!text || text.toUpperCase() === "NONE") return null;
    return text;
  } catch {
    return null;
  }
}

async function resolveCoinId(question: string): Promise<string | null> {
  const extracted = await extractCoinQuery(question);
  const searchTerm = extracted ?? question;
  try {
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(searchTerm)}`);
    const searchData = await searchRes.json();
    return searchData.coins?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// Asks Claude for ONLY the interpretive insight paragraph — never the raw
// numbers (those are already shown above it, so repeating them is banned).
async function getAiInsight(data: any, question: string): Promise<string> {
  try {
    const apiKey = (import.meta as any).env.VITE_ANTHROPIC_KEY;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 150,
        system: `You write ONLY a "multi-timeframe insight" for a crypto analysis card. HARD LIMITS, no exceptions: maximum 300 characters total, maximum 2 sentences. Count carefully — if you're unsure whether you're near the limit, write a shorter first sentence so the whole thing fits. Never end mid-sentence; a shorter complete thought is always better than a longer cut-off one. The price, market cap, per-timeframe RSI/trend, and MACD are ALREADY shown to the user above this text in their own sections — do NOT restate the price, percentage changes, specific EMA values, or specific MACD values (those are shown elsewhere). Instead, purely synthesize the momentum/structure picture: contrast short-term vs longer-term momentum, note if a timeframe's RSI stands out (overbought >70, oversold <30), and note the overall structural bias. Do NOT use the word "divergence" or its translations (e.g. Turkish "uyumsuzluk") — that is a specific technical term (price vs. indicator moving opposite directions) and doesn't apply just because RSI values differ across timeframes. If you want to describe RSI values differing across timeframes, say something like "momentum ayrışması" (Turkish) / "momentum divergence across timeframes" only if literally describing differing RSI levels, not implying the technical divergence pattern. Use ONLY the exact numbers given below — never invent or alter any. Never recommend buying, selling, or holding, never call something a "good" or "bad" time to trade, never predict what will happen next. Respond in the same language as the user's original question. Output ONLY the sentence(s), no headers, no markdown.

Data:
${JSON.stringify(data, null, 2)}`,
        messages: [{ role: "user", content: question }],
      }),
    });
    const json = await res.json();
    const raw = json.content?.[0]?.text?.trim() ?? "";
    // Safety net in case the model exceeds the 300-char instruction anyway —
    // never show a sentence cut off mid-word. Trim to the last complete
    // sentence boundary within a hard 320-char ceiling.
    if (raw.length <= 320) return raw;
    const truncated = raw.slice(0, 320);
    const lastSentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf(".\n"), truncated.lastIndexOf("? "), truncated.lastIndexOf("! "));
    return lastSentenceEnd > 50 ? truncated.slice(0, lastSentenceEnd + 1) : truncated;
  } catch {
    return "";
  }
}

export async function getFormattedMarketAnalysis(question: string): Promise<string | null> {
  const coinId = await resolveCoinId(question);
  if (!coinId) return null;

  let data: any;
  try {
    const res = await fetch(`/api/market-analysis?coinId=${coinId}`);
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  let out = `${data.name} · ${data.symbol}\n`;
  out += `${fmtCompact(data.price)}\n`;
  out += `${pct(data.change?.h24)} 24H · ${pct(data.change?.d7)} 7D · ${pct(data.change?.d30)} 30D\n\n`;

  out += `TIMEFRAME\n`;
  for (const tf of ["1H", "4H", "1D", "1W", "1M"] as const) {
    const t = data.timeframes?.[tf];
    const rsiText = t?.rsi != null ? `RSI ${t.rsi.toFixed(1)}` : "";
    out += `${trendDot(t?.structure)} ${tf} — ${trendLabel(t?.structure)}${rsiText ? " · " + rsiText : ""}\n`;
  }

  out += `\nKEY LEVELS\n`;
  const p = data.pivotLevels;
  if (p) {
    out += `Support\nS1 ${fmtCompact(p.s1)} · S2 ${fmtCompact(p.s2)} · S3 ${fmtCompact(p.s3)}\n`;
    out += `Resistance\nR1 ${fmtCompact(p.r1)} · R2 ${fmtCompact(p.r2)} · R3 ${fmtCompact(p.r3)}\n`;
  } else {
    out += `Not enough data to compute levels.\n`;
  }

  const macd = data.technicals?.macd;
  if (macd) {
    out += `\nMACD ${macd.bullish ? "🟢 Bullish" : "🔴 Bearish"}\n`;
    out += `${macd.value.toFixed(2)} ${macd.bullish ? "above" : "below"} signal ${macd.signal.toFixed(2)}\n`;
  }

  const insight = await getAiInsight(data, question);
  if (insight) out += `\nMULTI-TIMEFRAME INSIGHT\n${insight}\n`;

  // Deterministic, template-based — not AI-generated, so it's always
  // consistent, correctly hedged ("could", never "will"), and directly tied
  // to the real pivot ladder above.
  if (p) {
    out += `\nWHAT TO WATCH\n`;
    out += `🟢 Bullish scenario\nA sustained move above ${fmtCompact(p.r1)} could bring ${fmtCompact(p.r2)} and ${fmtCompact(p.r3)} into focus.\n`;
    out += `🔴 Bearish scenario\nA break below ${fmtCompact(p.s1)} could shift attention toward ${fmtCompact(p.s2)} and ${fmtCompact(p.s3)}.\n`;
  }

  out += `\nTokenomics\n${fmt(data.supply?.circulating)} circulating · ${data.supply?.max ? fmt(data.supply.max) + " max supply" : "uncapped supply"}\n`;

  const curated = getTokenUnlockInfo(coinId);
  if (curated) {
    if (curated.unlockStatus.type === "scheduled") {
      out += `Next unlock: ${curated.unlockStatus.date} — ${curated.unlockStatus.amount} (${curated.unlockStatus.percentOfCirculating}).\n`;
    } else if (curated.unlockStatus.type === "no_fixed_schedule") {
      out += `No fixed unlock schedule — ${curated.unlockStatus.note}\n`;
    }
  }

  out += `\n⚠️ Not financial advice. Always conduct your own research and make your own decisions.`;

  return out;
}

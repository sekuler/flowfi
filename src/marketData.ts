// Client-side glue: resolves whatever coin the user mentions (any language),
// calls our own /api/market-analysis backend (which does all the real math
// server-side, cached), then formats a clean report. The AI is only asked
// to write the final short summary paragraph — never the numbers.
//
// This replaces the old approach of stuffing a giant text blob into Claude's
// prompt and hoping it formats things correctly. Now the numbers are 100%
// deterministic, code-generated — Claude cannot alter or invent them.

import { getTokenUnlockInfo } from "./tokenUnlocks";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
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

// Asks Claude for ONLY the short interpretive summary — given the exact real
// numbers, nothing else. It cannot introduce new figures because none of the
// deterministic sections around it were written by it.
async function getAiSummary(data: any, question: string): Promise<string> {
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
        max_tokens: 200,
        system: `You write ONLY a short 2-4 sentence technical summary paragraph for a crypto analysis report. You are given real computed data below — use ONLY these exact numbers, never invent, round differently, or add any figure not given to you. Describe the current picture (trend across timeframes, RSI reads, position relative to pivot) in neutral, descriptive language. Never recommend buying, selling, or holding, never say "good" or "bad" time to trade, never predict what will happen next — only describe what the data currently shows. Respond in the same language as the user's original question. Output ONLY the paragraph, no headers, no markdown, no disclaimer (that's added separately).

Data:
${JSON.stringify(data, null, 2)}`,
        messages: [{ role: "user", content: question }],
      }),
    });
    const json = await res.json();
    return json.content?.[0]?.text?.trim() ?? "";
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

  let out = `${data.name} (${data.symbol})\n`;
  out += `$${fmt(data.price)}\n`;
  out += `24H ${pct(data.change?.h24)} · 7D ${pct(data.change?.d7)} · 30D ${pct(data.change?.d30)}\n\n`;

  out += `Timeframe Overview\n`;
  for (const tf of ["1H", "4H", "1D", "1W", "1M"] as const) {
    const t = data.timeframes?.[tf];
    const rsiText = t?.rsi != null ? t.rsi.toFixed(1) : "—";
    out += `${tf}: ${trendLabel(t?.structure)} · RSI ${rsiText}\n`;
  }

  out += `\nKey Levels\n`;
  if (data.pivotLevels) {
    out += `Support: $${fmt(data.pivotLevels.s1)} · $${fmt(data.pivotLevels.s2)} · $${fmt(data.pivotLevels.s3)}\n`;
    out += `Resistance: $${fmt(data.pivotLevels.r1)} · $${fmt(data.pivotLevels.r2)} · $${fmt(data.pivotLevels.r3)}\n`;
  } else {
    out += `Not enough data to compute levels.\n`;
  }

  out += `\nSupply\n`;
  out += `Circulating: ${fmt(data.supply?.circulating)} — Total: ${fmt(data.supply?.total)} — Max: ${data.supply?.max ? fmt(data.supply.max) : "Uncapped"}\n`;

  const curated = getTokenUnlockInfo(coinId);
  if (curated) {
    if (curated.unlockStatus.type === "scheduled") {
      out += `\nNext Unlock\n${curated.unlockStatus.date} — ${curated.unlockStatus.amount} (${curated.unlockStatus.percentOfCirculating}). Recorded ${curated.recordedAt}, may need a refresh if this date has passed.\n`;
    } else if (curated.unlockStatus.type === "no_fixed_schedule") {
      out += `\nUnlock Schedule\nNo fixed cliff date. ${curated.unlockStatus.note}\n`;
    }
  } else {
    out += `\nUnlock Schedule\nNo data source available.\n`;
  }

  const summary = await getAiSummary(data, question);
  if (summary) out += `\nSummary\n${summary}\n`;

  out += `\n⚠️ This analysis is provided for informational and educational purposes only and does not constitute financial, investment, or trading advice. Technical indicators and market data can be inaccurate or change rapidly. Always conduct your own research and make your own decisions.`;

  return out;
}

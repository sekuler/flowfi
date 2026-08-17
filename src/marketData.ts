// Client-side glue: resolves whatever coin the user mentions (any language),
// calls our own /api/market-analysis backend (which does all the real math
// server-side, cached), then formats a clean report. The AI is only asked
// for a short interpretive paragraph — it must not restate numbers that are
// already shown deterministically above it.

import { getTokenUnlockInfo, type TokenUnlockInfo } from "./tokenUnlocks";

// Tries DropsTab's real, live unlock API first (any token they track, not
// just our curated list). Falls back to null on any failure — 404 (token
// not tracked by DropsTab) is expected and normal, not an error to surface.
async function fetchLiveUnlockInfo(coinId: string): Promise<TokenUnlockInfo["unlockStatus"] | null> {
  try {
    const res = await fetch(`/api/dropstab?coinSlug=${encodeURIComponent(coinId)}`);
    if (!res.ok) return null;
    const data = await res.json();

    // DropsTab's response shape varies by endpoint version — handle the
    // known variants defensively rather than assuming one exact shape.
    if (data.date && data.amount) {
      return {
        type: "scheduled",
        date: data.date,
        amount: `${Number(data.amount).toLocaleString()} tokens${data.coin ? ` (${data.coin})` : ""}`,
        percentOfCirculating: data.percentage ? `${data.percentage}% of supply` : "unknown",
      };
    }
    if (Array.isArray(data.unlockSchedule) && data.unlockSchedule.length > 0) {
      const next = data.unlockSchedule[0];
      return {
        type: "scheduled",
        date: next.date,
        amount: `${Number(next.amount).toLocaleString()} tokens`,
        percentOfCirculating: "see DropsTab for full schedule",
      };
    }
    return null;
  } catch {
    return null;
  }
}

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
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 150,
        system: `You write ONLY a "multi-timeframe insight" for a crypto analysis card.

THREE NON-NEGOTIABLE RULES — violating any of these is a critical failure:
1. NEVER contradict or soften a given trend/structure value. If a timeframe's structure says "uptrend", your text must treat it as an uptrend — never describe it as "under pressure", "weak", "bearish", or similar, even subtly. Same for "downtrend" — never describe it as strong or bullish.
2. NEVER conflate RSI level with trend/structure. RSI and structure are two separate, independent numbers you're given — a neutral RSI (40-60) does NOT mean weak structure, and a strong uptrend does NOT mean high RSI. Describe each using only what that specific number shows, never inferring one from the other.
3. ONLY use a technical term (overbought, oversold, bullish crossover, bearish crossover, momentum divergence, etc.) when the actual supplied numeric condition for it is genuinely met. Never use a technical term for flavor or because it "sounds right" — check the number first.

STRUCTURE-VS-MOMENTUM CAN DIFFER — THIS IS NORMAL, EXPLAIN IT WHEN IT HAPPENS: If all timeframes share the same structure (e.g. all "uptrend"), only call this "full alignment" or "complete agreement" if the RSI values are ALSO consistent with that read (not deeply oversold/overbought in a way that contradicts the structure's implied strength). If the structure is aligned (e.g. all uptrend) but RSI values are notably weak (e.g. oversold, <35) on the shorter timeframes, say so explicitly and explain the distinction: structure (price highs/lows) staying in an uptrend while momentum (RSI) weakens on shorter timeframes is a completely normal, non-contradictory pattern — briefly frame it that way rather than calling it a "perfect" or "complete" alignment when the momentum picture is actually mixed. Never say "tam bir uyum" / "full alignment" / "complete agreement" unless RSI values across the timeframes are also reasonably consistent with each other, not just the structure labels.

Hard limits, no exceptions: maximum 300 characters total, maximum 2 sentences. Count carefully — if you're unsure whether you're near the limit, write a shorter first sentence so the whole thing fits. Never end mid-sentence; a shorter complete thought is always better than a longer cut-off one. The price, market cap, per-timeframe RSI/trend, and MACD are ALREADY shown to the user above this text in their own sections — do NOT restate the price, percentage changes, specific EMA values, or specific MACD values (those are shown elsewhere).

TIMEFRAME LABELS: preserve the timeframe labels EXACTLY as given: 1H, 4H, 1D, 1W, 1M. Never translate them (e.g. never write "1S" for 1H in Turkish or any other language-adapted label) — they stay in English exactly as written, always.

ANALYSIS CONSISTENCY — read these before writing anything:
- The narrative must be derived directly from the supplied timeframe data, nothing else.
- Never describe a timeframe as bearish or "under pressure" when its structure is explicitly "uptrend" (or bullish when explicitly "downtrend"), unless another supplied indicator clearly and specifically contradicts it.
- Never infer weakness or pressure solely from RSI being in the neutral 40-60 range — neutral RSI means neutral momentum, not weakness. Only call momentum "weak" if RSI is genuinely low, or "strong"/"overbought" if genuinely high.
- Do not use generic market-analysis phrases (like "short-term strength, long-term weakness") unless the actual supplied data specifically supports that exact pattern — check every timeframe before writing, don't default to a template.
- If ALL timeframes show the same structure (all uptrend, or all downtrend), explicitly say so — acknowledge the alignment rather than inventing a contrast that isn't there. But per the rule above, don't call it "full alignment" if RSI tells a genuinely different momentum story — describe both the structural alignment AND the momentum picture honestly.
- If timeframes genuinely conflict (some uptrend, some downtrend), explicitly describe that real conflict.

Instead, purely synthesize the momentum/structure picture using only what the data actually shows: note if a timeframe's RSI stands out (overbought >70, oversold <30), and state the overall structural bias truthfully. Do NOT use the word "divergence" or its translations (e.g. Turkish "uyumsuzluk") — that is a specific technical term (price vs. indicator moving opposite directions) and doesn't apply just because RSI values differ across timeframes. If you want to describe RSI values differing across timeframes, say something like "momentum ayrışması" (Turkish) / "momentum divergence across timeframes" only if literally describing differing RSI levels, not implying the technical divergence pattern. Use ONLY the exact numbers given below — never invent or alter any. Never recommend buying, selling, or holding, never call something a "good" or "bad" time to trade, never predict what will happen next. Respond in the same language as the user's original question. Output ONLY the sentence(s), no headers, no markdown.

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

  if (data.assetType === "stablecoin") {
    return formatStablecoinAnalysis(data, question);
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
    out += `\nMACD: ${macd.bullish ? "Bullish crossover / positive momentum" : "Bearish crossover / negative momentum"}\n`;
    out += `(${macd.value.toFixed(4)} ${macd.bullish ? "above" : "below"} signal ${macd.signal.toFixed(4)})\n`;
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

  const liveUnlock = await fetchLiveUnlockInfo(coinId);
  const curated = getTokenUnlockInfo(coinId);
  const unlockStatus = liveUnlock ?? curated?.unlockStatus;
  if (unlockStatus) {
    const sourceNote = liveUnlock ? "live via DropsTab" : "manually curated";
    if (unlockStatus.type === "scheduled") {
      out += `\nToken Vesting & Unlocks (${sourceNote})\nUpcoming: ${unlockStatus.date}\n${unlockStatus.amount} · ${unlockStatus.percentOfCirculating}\n`;
    } else if (unlockStatus.type === "no_fixed_schedule") {
      out += `\nToken Vesting & Unlocks (${sourceNote})\nOngoing linear vesting (no single cliff date) — ${unlockStatus.note}\n`;
    }
  }

  out += `\n⚠️ Not financial advice. Always conduct your own research and make your own decisions.`;

  return out;
}

// Separate, honest format for stablecoin-like assets — standard technical
// analysis (RSI/MACD/support-resistance/bullish-bearish scenarios) is
// misleading for a price that's supposed to sit near a peg, so we don't
// show it. We only show what's genuinely meaningful here: price stability,
// trend/momentum in relative (not price-level) terms, supply, and unlocks.
// We deliberately do NOT claim to know APY, yield source, or redemption
// mechanics — we have no reliable data source for those per-token, and
// showing them without real data would mean fabricating.
async function getStablecoinInsight(data: any, question: string): Promise<string> {
  try {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 150,
        system: `You write ONLY a MAXIMUM 300-character, maximum-2-sentence note about a stablecoin-like asset's price stability.

THREE NON-NEGOTIABLE RULES: (1) Never contradict a given trend/structure value — if it says "uptrend", don't call it weak or under pressure. (2) Never conflate RSI level with trend/structure — they're independent numbers, describe each on its own terms. (3) Only use a technical term when its exact numeric condition is genuinely met.

This is NOT a volatile crypto asset — do not use bullish/bearish trading language, do not discuss support/resistance breakouts, do not discuss "momentum" the way you would for BTC. Preserve timeframe labels EXACTLY as given (1H, 4H, 1D, 1W) — never translate them. Base everything strictly on the supplied data, not a generic template — if all timeframes show similar stability, say so plainly rather than inventing contrast. Factually describe how close the price is holding to its recent range, and whether recent movement has been minor or notable, using the exact numbers given. Do not claim to know the yield/APY, redemption mechanism, or backing assets — you don't have that data, so don't mention them at all. Use ONLY the exact numbers given below. Never recommend buying, selling, or holding. Respond in the same language as the user's original question. Output ONLY the sentence(s), no headers, no markdown.

Data:
${JSON.stringify(data, null, 2)}`,
        messages: [{ role: "user", content: question }],
      }),
    });
    const json = await res.json();
    const raw = json.content?.[0]?.text?.trim() ?? "";
    if (raw.length <= 320) return raw;
    const truncated = raw.slice(0, 320);
    const lastSentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf(".\n"));
    return lastSentenceEnd > 50 ? truncated.slice(0, lastSentenceEnd + 1) : truncated;
  } catch {
    return "";
  }
}

async function formatStablecoinAnalysis(data: any, question: string): Promise<string> {
  let out = `${data.name} · ${data.symbol} (stable-value asset)\n`;
  out += `$${fmt(data.price)}\n`;
  out += `${pct(data.change?.h24)} 24H · ${pct(data.change?.d7)} 7D · ${pct(data.change?.d30)} 30D\n\n`;

  out += `PRICE STABILITY\n`;
  for (const tf of ["1H", "4H", "1D", "1W"] as const) {
    const t = data.timeframes?.[tf];
    const rsiText = t?.rsi != null ? `RSI ${t.rsi.toFixed(1)}` : "";
    out += `${trendDot(t?.structure)} ${tf} — ${trendLabel(t?.structure)}${rsiText ? " · " + rsiText : ""}\n`;
  }

  const insight = await getStablecoinInsight(data, question);
  if (insight) out += `\nSTABILITY NOTE\n${insight}\n`;

  out += `\nSupply\n${fmt(data.supply?.circulating)} circulating · ${data.supply?.max ? fmt(data.supply.max) + " max supply" : "uncapped supply"}\n`;

  const liveUnlock2 = await fetchLiveUnlockInfo(data.coinId);
  const curated = getTokenUnlockInfo(data.coinId);
  const unlockStatus2 = liveUnlock2 ?? curated?.unlockStatus;
  if (unlockStatus2) {
    const sourceNote = liveUnlock2 ? "live via DropsTab" : "manually curated";
    if (unlockStatus2.type === "scheduled") {
      out += `\nToken Vesting & Unlocks (${sourceNote})\nUpcoming: ${unlockStatus2.date}\n${unlockStatus2.amount} · ${unlockStatus2.percentOfCirculating}\n`;
    } else if (unlockStatus2.type === "no_fixed_schedule") {
      out += `\nToken Vesting & Unlocks (${sourceNote})\nOngoing linear vesting (no single cliff date) — ${unlockStatus2.note}\n`;
    }
  }

  out += `\nNote: This looks like a stable-value asset, so standard technical analysis (RSI/MACD/support-resistance breakout scenarios) isn't shown — those tools are built for volatile assets and would be misleading here.\n`;
  out += `\n⚠️ Not financial advice. Always conduct your own research and make your own decisions.`;

  return out;
}

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
    if (!res.ok) {
      return null;
    }
    const data = await res.json();

    // Real confirmed shape (2026-08-17): data.allocations[] each optionally
    // has a tokenUnlockProgress object with nextTokenUnlockDate. Find the
    // soonest upcoming one across all allocation categories.
    const allocations: any[] = Array.isArray(data.allocations) ? data.allocations : [];
    const upcoming = allocations
      .filter((a) => a.tokenUnlockProgress?.nextTokenUnlockDate)
      .sort((a, b) => new Date(a.tokenUnlockProgress.nextTokenUnlockDate).getTime() - new Date(b.tokenUnlockProgress.nextTokenUnlockDate).getTime());

    if (upcoming.length > 0) {
      const next = upcoming[0];
      const progress = next.tokenUnlockProgress;
      const lockedAmount = progress.lockedTokensAmount != null ? `${Number(progress.lockedTokensAmount).toLocaleString()} tokens still locked` : "amount unknown";
      const lockedPct = progress.lockedTokensPercent != null ? `${progress.lockedTokensPercent}% of this allocation still locked` : "";
      return {
        type: "scheduled",
        date: progress.nextTokenUnlockDate,
        amount: `${next.name ?? "allocation"} — ${lockedAmount}`,
        percentOfCirculating: lockedPct || "unknown",
      };
    }

    // No allocation has a future date tracked — describe overall progress
    // honestly instead of inventing a schedule.
    if (typeof data.totalTokensUnlockedPercent === "number") {
      return {
        type: "no_fixed_schedule",
        note: `${data.totalTokensUnlockedPercent}% of allocated tokens are already unlocked (DropsTab live data). No specific future unlock date is currently tracked for any allocation.`,
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
    return formatStablecoinAnalysis(data);
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

  const insight = data.insight ?? "";
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
async function formatStablecoinAnalysis(data: any): Promise<string> {
  let out = `${data.name} · ${data.symbol} (stable-value asset)\n`;
  out += `$${fmt(data.price)}\n`;
  out += `${pct(data.change?.h24)} 24H · ${pct(data.change?.d7)} 7D · ${pct(data.change?.d30)} 30D\n\n`;

  out += `PRICE STABILITY\n`;
  for (const tf of ["1H", "4H", "1D", "1W"] as const) {
    const t = data.timeframes?.[tf];
    const rsiText = t?.rsi != null ? `RSI ${t.rsi.toFixed(1)}` : "";
    out += `${trendDot(t?.structure)} ${tf} — ${trendLabel(t?.structure)}${rsiText ? " · " + rsiText : ""}\n`;
  }

  const insight = data.insight ?? "";
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

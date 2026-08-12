// Real market data + real technical analysis for any coin the user mentions.
// Every number here is either fetched live from CoinGecko or computed with
// standard, well-known formulas (RSI, EMA, MACD, pivot points) applied to
// that real data — nothing is fabricated or predicted.
//
// Honesty limits, on purpose:
// - 1H candles are built by aggregating CoinGecko's real 30-minute candles
//   (from its 1-day OHLC endpoint) two at a time — genuine data, not faked.
// - 1M (monthly) is not included — no reliable long-range granularity is
//   available on the free tier without noisy gaps, so it's omitted rather
//   than approximated.
// - Token unlock/vesting schedules and news/catalysts are not integrated
//   yet. The AI is instructed to say so rather than guess.

import { getTokenUnlockInfo } from "./tokenUnlocks";

interface Candle { time: number; open: number; high: number; low: number; close: number; }

function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeEMASeries(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const series: number[] = [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    series.push(ema);
  }
  return series;
}

function computeEMA(closes: number[], period: number): number | null {
  const series = computeEMASeries(closes, period);
  return series.length ? series[series.length - 1] : null;
}

function computeMACD(closes: number[]): { macd: number; signal: number } | null {
  if (closes.length < 35) return null;
  const ema12 = computeEMASeries(closes, 12);
  const ema26 = computeEMASeries(closes, 26);
  const offset = ema12.length - ema26.length;
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
  if (macdLine.length < 9) return null;
  const signalSeries = computeEMASeries(macdLine, 9);
  return { macd: macdLine[macdLine.length - 1], signal: signalSeries[signalSeries.length - 1] };
}

function pivotLevels(high: number, low: number, close: number) {
  const pivot = (high + low + close) / 3;
  return {
    r3: high + 2 * (pivot - low),
    r2: pivot + (high - low),
    r1: 2 * pivot - low,
    pivot,
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
    s3: low - 2 * (high - pivot),
  };
}

// Simple, honest market-structure read: compares the first half vs second
// half of a window's swing highs/lows — not a fabricated pattern-recognition
// claim, just a plain comparison of real numbers.
function marketStructure(candles: Candle[]): string {
  const mid = Math.floor(candles.length / 2);
  const firstHalf = candles.slice(0, mid);
  const secondHalf = candles.slice(mid);
  if (firstHalf.length === 0 || secondHalf.length === 0) return "not enough data";
  const highFirst = Math.max(...firstHalf.map((c) => c.high));
  const highSecond = Math.max(...secondHalf.map((c) => c.high));
  const lowFirst = Math.min(...firstHalf.map((c) => c.low));
  const lowSecond = Math.min(...secondHalf.map((c) => c.low));
  const higherHighs = highSecond > highFirst;
  const higherLows = lowSecond > lowFirst;
  if (higherHighs && higherLows) return "higher highs and higher lows (uptrend structure)";
  if (!higherHighs && !higherLows) return "lower highs and lower lows (downtrend structure)";
  return "mixed / consolidating structure";
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}

async function fetchOHLC(coinId: string, days: string): Promise<Candle[] | null> {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);
    const raw: number[][] = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw.map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
  } catch {
    return null;
  }
}

// Aggregate real 30-min candles (CoinGecko's native days=1 granularity) into
// genuine 1-hour candles, two at a time.
function aggregateHourly(thirtyMin: Candle[]): Candle[] {
  const hourly: Candle[] = [];
  for (let i = 0; i < thirtyMin.length; i += 2) {
    const chunk = thirtyMin.slice(i, i + 2);
    if (chunk.length === 0) continue;
    hourly.push({
      time: chunk[0].time,
      open: chunk[0].open,
      close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
    });
  }
  return hourly;
}

function resampleWeekly(daily: Candle[]): Candle[] {
  const weeks: Candle[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    if (chunk.length === 0) continue;
    weeks.push({
      time: chunk[0].time,
      open: chunk[0].open,
      close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
    });
  }
  return weeks;
}

function timeframeBlock(label: string, candles: Candle[], includeStructure = true): string {
  const closes = candles.map((c) => c.close);
  const rsi = computeRSI(closes);
  let out = `${label}: RSI(14) ${rsi !== null ? rsi.toFixed(1) : "n/a"}`;
  if (includeStructure) out += `, structure: ${marketStructure(candles)}`;
  return out + "\n";
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

export async function buildMarketContext(question: string): Promise<string> {
  let context = "";

  try {
    const quickRes = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
    );
    const quick = await quickRes.json();
    context += `Live reference prices (USD): BTC $${quick.bitcoin?.usd} (${quick.bitcoin?.usd_24h_change?.toFixed(2)}% 24h), ETH $${quick.ethereum?.usd} (${quick.ethereum?.usd_24h_change?.toFixed(2)}% 24h), SOL $${quick.solana?.usd} (${quick.solana?.usd_24h_change?.toFixed(2)}% 24h).\n`;
  } catch {
    context += "Live reference prices were unavailable.\n";
  }

  try {
    const extracted = await extractCoinQuery(question);
    const searchTerm = extracted ?? question;
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(searchTerm)}`);
    const searchData = await searchRes.json();
    const coinId: string | undefined = searchData.coins?.[0]?.id;
    if (!coinId) return context;

    const detailRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
    );
    const detail = await detailRes.json();
    const md = detail.market_data;
    if (!md) return context;

    context += `\n=== ${detail.name} (${detail.symbol?.toUpperCase()}) ===\n`;
    context += `Price: $${md.current_price?.usd}\n`;
    context += `Market cap: $${md.market_cap?.usd?.toLocaleString()}\n`;
    context += `24h volume: $${md.total_volume?.usd?.toLocaleString()}\n`;
    context += `Change: ${md.price_change_percentage_24h?.toFixed(2)}% (24h), ${md.price_change_percentage_7d?.toFixed(2)}% (7d), ${md.price_change_percentage_30d?.toFixed(2)}% (30d)\n`;
    context += `Circulating supply: ${md.circulating_supply ? Number(md.circulating_supply).toLocaleString() : "unknown"}\n`;
    context += `Total supply: ${md.total_supply ? Number(md.total_supply).toLocaleString() : "unknown"}\n`;
    context += `Max supply: ${md.max_supply ? Number(md.max_supply).toLocaleString() : "uncapped or unknown"}\n`;
    const curated = getTokenUnlockInfo(coinId);
    if (curated) {
      context += `\nCurated unlock/tokenomics data (manually verified on ${curated.recordedAt}, source: ${curated.source}):\n`;
      context += `Allocation breakdown: ${Object.entries(curated.allocationBreakdown).map(([k, v]) => `${k} ${v}`).join(", ")}\n`;
      if (curated.unlockStatus.type === "not_yet_provided") {
        context += `Unlock schedule: not yet gathered for this token — say this data isn't available yet rather than guessing.\n`;
      } else if (curated.unlockStatus.type === "no_fixed_schedule") {
        context += `Unlock schedule: no fixed cliff date. ${curated.unlockStatus.note}\n`;
      } else {
        context += `Next scheduled unlock: ${curated.unlockStatus.date} — ${curated.unlockStatus.amount} (${curated.unlockStatus.percentOfCirculating}). Note: this was recorded on ${curated.recordedAt} and may be stale if that date has already passed — mention this date as informational, and if it's clearly in the past relative to today, say the schedule may need a refresh rather than presenting it as still upcoming.\n`;
      }
    } else {
      context += `Token unlock schedule: NO DATA SOURCE AVAILABLE — do not guess or invent unlock dates/amounts.\n`;
    }
    context += `News/catalysts: NO DATA SOURCE AVAILABLE — do not invent news or events.\n`;

    // Real 1H (aggregated from genuine 30-min candles).
    const ohlc1d = await fetchOHLC(coinId, "1");
    if (ohlc1d && ohlc1d.length >= 4) {
      const hourly = aggregateHourly(ohlc1d);
      context += "\n" + timeframeBlock("1H (aggregated from real 30-min candles)", hourly);
    } else {
      context += "\n1H: data temporarily unavailable (likely a rate limit on the free data source) — say so honestly if asked, don't show a blank n/a without explanation.\n";
    }

    await new Promise((r) => setTimeout(r, 300));

    // Real 4H (native candles from CoinGecko's 7-day OHLC).
    const ohlc7d = await fetchOHLC(coinId, "7");
    if (ohlc7d && ohlc7d.length >= 10) {
      context += timeframeBlock("4H (native candles, 7-day window)", ohlc7d);
    } else {
      context += "4H: data temporarily unavailable (likely a rate limit on the free data source).\n";
    }

    await new Promise((r) => setTimeout(r, 300));

    // Real 1D (daily candles from a 90-day window) — also used for EMA/MACD/pivots.
    const ohlc90d = await fetchOHLC(coinId, "90");
    if (ohlc90d && ohlc90d.length >= 15) {
      context += timeframeBlock("1D (native daily candles, 90-day window)", ohlc90d);

      const closes90 = ohlc90d.map((c) => c.close);
      const ema20 = computeEMA(closes90, 20);
      const ema50 = computeEMA(closes90, 50);
      const macd = computeMACD(closes90);
      const price = closes90[closes90.length - 1];
      context += `\nEMA20: $${ema20 ? fmt(ema20) : "n/a"} — price is ${ema20 ? (price > ema20 ? "above" : "below") : "n/a"} it\n`;
      context += `EMA50: $${ema50 ? fmt(ema50) : "n/a"} — price is ${ema50 ? (price > ema50 ? "above" : "below") : "n/a"} it\n`;
      if (macd) context += `MACD: ${macd.macd.toFixed(4)}, Signal: ${macd.signal.toFixed(4)} (${macd.macd > macd.signal ? "bullish crossover state" : "bearish crossover state"})\n`;

      // 3 real support + 3 real resistance levels from the 1D pivot calculation.
      const levels = pivotLevels(
        Math.max(...ohlc90d.slice(-30).map((c) => c.high)),
        Math.min(...ohlc90d.slice(-30).map((c) => c.low)),
        price
      );
      context += `\nPivot levels (from the last 30 days of real daily data):\n`;
      context += `Resistance: R1 $${fmt(levels.r1)}, R2 $${fmt(levels.r2)}, R3 $${fmt(levels.r3)}\n`;
      context += `Support: S1 $${fmt(levels.s1)}, S2 $${fmt(levels.s2)}, S3 $${fmt(levels.s3)}\n`;

      // Real 1W (aggregated from the same real daily data).
      const weekly = resampleWeekly(ohlc90d);
      if (weekly.length >= 5) {
        context += "\n" + timeframeBlock("1W (aggregated from real daily candles)", weekly);
      }
    } else {
      context += "1D and 1W: data temporarily unavailable (likely a rate limit on the free data source) — EMA/MACD/pivot levels could not be computed either, since they depend on this data. Say so honestly if asked, don't show blank n/a rows without explanation.\n";
    }
  } catch {
    context += "\nCould not resolve additional technical detail for the specific coin asked about.\n";
  }

  return context;
}

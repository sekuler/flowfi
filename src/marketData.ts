// Real market data + real technical analysis for any coin the user mentions.
// Every number here is either fetched live from CoinGecko or computed with
// standard, well-known formulas (RSI, EMA, MACD, pivot points) applied to
// that real data — nothing is fabricated or predicted.
//
// Honesty limits, on purpose:
// - CoinGecko's free tier doesn't provide clean 1-hour or 1-month candles,
//   so we only report timeframes we can genuinely back with real data:
//   4H (from 7 days of native 4h candles), 1D, and 1W (aggregated from daily
//   closes). We do not fake 1H/1M granularity we don't actually have.
// - Token unlock/vesting schedules are not available from any free source
//   we've integrated. The AI is instructed to say so rather than guess.
// - No news/catalyst data is integrated yet.

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

function computeEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
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

function timeframeSection(label: string, candles: Candle[]): string {
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const rsi = computeRSI(closes);
  const levels = pivotLevels(
    Math.max(...candles.map((c) => c.high)),
    Math.min(...candles.map((c) => c.low)),
    last.close
  );
  let out = `\n${label}:\n`;
  out += `  RSI(14): ${rsi !== null ? rsi.toFixed(1) : "not enough data"}\n`;
  out += `  Pivot levels — R3 $${fmt(levels.r3)}, R2 $${fmt(levels.r2)}, R1 $${fmt(levels.r1)}, Pivot $${fmt(levels.pivot)}, S1 $${fmt(levels.s1)}, S2 $${fmt(levels.s2)}, S3 $${fmt(levels.s3)}\n`;
  return out;
}

// Resample a daily OHLC series into weekly candles for a real (not faked) 1W view.
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
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(question)}`);
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
    context += `Token unlock schedule: NO DATA SOURCE AVAILABLE — do not guess or invent unlock dates/amounts. If asked, say this data isn't available yet.\n`;

    // Real 4H timeframe (native 4h candles from CoinGecko's 7-day OHLC).
    const ohlc7d = await fetchOHLC(coinId, "7");
    if (ohlc7d && ohlc7d.length >= 10) {
      context += timeframeSection("4H timeframe (from real 7-day 4-hour candles)", ohlc7d);
    }

    // Real 1D timeframe (daily candles from a 90-day window).
    const ohlc90d = await fetchOHLC(coinId, "90");
    if (ohlc90d && ohlc90d.length >= 15) {
      context += timeframeSection("1D timeframe (from real 90-day daily candles)", ohlc90d);
      const closes90 = ohlc90d.map((c) => c.close);
      const ema20 = computeEMA(closes90, 20);
      const ema50 = computeEMA(closes90, 50);
      const macd = computeMACD(closes90);
      const price = closes90[closes90.length - 1];
      context += `  Price vs EMA20 (${ema20 ? fmt(ema20) : "n/a"}): ${ema20 ? (price > ema20 ? "above" : "below") : "not enough data"}\n`;
      context += `  Price vs EMA50 (${ema50 ? fmt(ema50) : "n/a"}): ${ema50 ? (price > ema50 ? "above" : "below") : "not enough data"}\n`;
      if (macd) context += `  MACD: ${macd.macd.toFixed(4)}, Signal: ${macd.signal.toFixed(4)} (${macd.macd > macd.signal ? "bullish crossover state" : "bearish crossover state"})\n`;

      // Real 1W timeframe, aggregated from the same real daily data (no extra fabricated data).
      const weekly = resampleWeekly(ohlc90d);
      if (weekly.length >= 5) {
        context += timeframeSection("1W timeframe (aggregated from real daily candles)", weekly);
      }
    }

    context += `\nNote: 1H and 1M timeframes are not included — no reliable free real-time granularity is available for them, so they are omitted rather than approximated.\n`;
  } catch {
    context += "\nCould not resolve additional technical detail for the specific coin asked about.\n";
  }

  return context;
}

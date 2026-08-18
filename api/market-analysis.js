// api/market-analysis.js
//
// Server-side market data + technical analysis engine. Uses CoinGecko's
// /market_chart endpoint (NOT /ohlc) because market_chart gives genuine
// granularity on the free tier:
//   - days <= 90: hourly price points
//   - days  > 90: daily price points (00:00 UTC)
// The /ohlc endpoint silently degrades to 4-day candles for any request
// beyond 30 days on the free tier — that was the root cause of "1D" actually
// being 4-day data earlier. market_chart avoids that entirely.
//
// We build our own candles (open/high/low/close) by grouping consecutive
// price points into buckets — real math on real data, not fabricated.
//
// Cached 90s per coin so repeated requests (from any user) don't hammer
// CoinGecko — this endpoint only actually calls out once per coin per 90s.
//
// GET /api/market-analysis?coinId=bitcoin

const CACHE_TTL_MS = 90 * 1000;
const cache = new Map();

function computeRSI(closes, period = 14) {
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

function computeEMASeries(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const series = [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    series.push(ema);
  }
  return series;
}

function computeEMA(closes, period) {
  const series = computeEMASeries(closes, period);
  return series.length ? series[series.length - 1] : null;
}

function computeMACD(closes) {
  if (closes.length < 35) return null;
  const ema12 = computeEMASeries(closes, 12);
  const ema26 = computeEMASeries(closes, 26);
  const offset = ema12.length - ema26.length;
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
  if (macdLine.length < 9) return null;
  const signalSeries = computeEMASeries(macdLine, 9);
  return { macd: macdLine[macdLine.length - 1], signal: signalSeries[signalSeries.length - 1] };
}

function pivotLevels(high, low, close) {
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

function marketStructure(candles) {
  const mid = Math.floor(candles.length / 2);
  const firstHalf = candles.slice(0, mid);
  const secondHalf = candles.slice(mid);
  if (firstHalf.length === 0 || secondHalf.length === 0) return "insufficient_data";
  const highFirst = Math.max(...firstHalf.map((c) => c.high));
  const highSecond = Math.max(...secondHalf.map((c) => c.high));
  const lowFirst = Math.min(...firstHalf.map((c) => c.low));
  const lowSecond = Math.min(...secondHalf.map((c) => c.low));
  const higherHighs = highSecond > highFirst;
  const higherLows = lowSecond > lowFirst;
  if (higherHighs && higherLows) return "uptrend";
  if (!higherHighs && !higherLows) return "downtrend";
  return "consolidating";
}

// Fetch raw [timestamp, price] points from market_chart, with one retry.
async function fetchPricePointsOnce(coinId, days) {
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
  if (!res.ok) throw new Error(`market_chart fetch failed (${res.status}) for days=${days}`);
  const data = await res.json();
  if (!data.prices || data.prices.length === 0) throw new Error(`Empty market_chart for days=${days}`);
  return data.prices; // [[timestamp, price], ...]
}

async function fetchPricePoints(coinId, days) {
  try {
    return await fetchPricePointsOnce(coinId, days);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await fetchPricePointsOnce(coinId, days);
    } catch {
      return null;
    }
  }
}

// Groups raw price points into candles by a fixed number of points per bucket.
function bucketize(points, pointsPerBucket) {
  const candles = [];
  for (let i = 0; i < points.length; i += pointsPerBucket) {
    const chunk = points.slice(i, i + pointsPerBucket);
    if (chunk.length === 0) continue;
    const prices = chunk.map((p) => p[1]);
    candles.push({
      time: chunk[0][0],
      open: prices[0],
      close: prices[prices.length - 1],
      high: Math.max(...prices),
      low: Math.min(...prices),
    });
  }
  return candles;
}

function timeframeSummary(candles) {
  // Require enough candles for RSI(14) to be meaningful — if we don't have
  // that, don't infer a trend/structure either. Partial data (e.g. 6-7
  // monthly candles) should show as "insufficient", not a real trend.
  if (!candles || candles.length < 15) return null;
  const closes = candles.map((c) => c.close);
  return { rsi: computeRSI(closes), structure: marketStructure(candles), candleCount: candles.length };
}

module.exports = async function handler(req, res) {
  const coinId = req.query.coinId;
  if (!coinId) return res.status(400).json({ error: "Missing coinId query parameter" });

  const cached = cache.get(coinId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.data, cached: true });
  }

  try {
    const detailRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
    );
    if (!detailRes.ok) return res.status(404).json({ error: `Coin not found: ${coinId}` });
    const detail = await detailRes.json();
    const md = detail.market_data;
    if (!md) return res.status(500).json({ error: "No market data available for this coin" });

    // Only 2 real CoinGecko calls needed:
    // - days=7 gives real HOURLY points -> genuine 1H and 4H candles
    // - days=180 gives real DAILY points (since >90) -> genuine 1D, 1W, 1M candles
    const hourlyPoints = await fetchPricePoints(coinId, "7");
    await new Promise((r) => setTimeout(r, 500));
    const dailyPoints = await fetchPricePoints(coinId, "180");

    const candles1H = hourlyPoints ? bucketize(hourlyPoints, 1) : null;   // 1 point/hour = 1H candles
    const candles4H = hourlyPoints ? bucketize(hourlyPoints, 4) : null;  // 4 points = 4H candles
    const candles1D = dailyPoints ? bucketize(dailyPoints, 1) : null;    // 1 point/day = 1D candles
    const candles1W = dailyPoints ? bucketize(dailyPoints, 7) : null;    // 7 points = 1W candles
    const candles1M = dailyPoints ? bucketize(dailyPoints, 30) : null;   // 30 points = 1M candles

    const closes1D = candles1D ? candles1D.map((c) => c.close) : [];
    const ema20 = closes1D.length ? computeEMA(closes1D, 20) : null;
    const ema50 = closes1D.length ? computeEMA(closes1D, 50) : null;
    const macd = closes1D.length ? computeMACD(closes1D) : null;

    let pivots = null;
    if (candles1D && candles1D.length >= 5) {
      const recent = candles1D.slice(-30);
      const price = closes1D[closes1D.length - 1];
      pivots = pivotLevels(Math.max(...recent.map((c) => c.high)), Math.min(...recent.map((c) => c.low)), price);
    }

    // Detect stablecoin-like assets using two real, honest signals — never
    // a guess: (1) CoinGecko's own category tags, or (2) genuinely low
    // 30-day price volatility (real math on real data). Standard technical
    // analysis (RSI/MACD/support-resistance/scenarios) is misleading for
    // these assets, so the frontend renders a different, more relevant view.
    const categories = Array.isArray(detail.categories) ? detail.categories : [];
    const isStablecoinByCategory = categories.some((c) =>
      typeof c === "string" && /stablecoin/i.test(c)
    );
    let isLowVolatility = false;
    if (candles1D && candles1D.length >= 15) {
      const recent = candles1D.slice(-30);
      const high = Math.max(...recent.map((c) => c.high));
      const low = Math.min(...recent.map((c) => c.low));
      const mid = (high + low) / 2;
      const rangePct = mid > 0 ? ((high - low) / mid) * 100 : 100;
      isLowVolatility = rangePct < 5; // less than 5% range over 30 days
    }
    const assetType = (isStablecoinByCategory || isLowVolatility) ? "stablecoin" : "crypto_asset";

    const result = {
      coinId,
      assetType,
      name: detail.name,
      symbol: detail.symbol ? detail.symbol.toUpperCase() : undefined,
      price: md.current_price ? md.current_price.usd : null,
      marketCap: md.market_cap ? md.market_cap.usd : null,
      volume24h: md.total_volume ? md.total_volume.usd : null,
      change: {
        h24: md.price_change_percentage_24h ?? null,
        d7: md.price_change_percentage_7d ?? null,
        d30: md.price_change_percentage_30d ?? null,
      },
      supply: {
        circulating: md.circulating_supply ?? null,
        total: md.total_supply ?? null,
        max: md.max_supply ?? null,
      },
      timeframes: {
        "1H": timeframeSummary(candles1H),
        "4H": timeframeSummary(candles4H),
        "1D": timeframeSummary(candles1D),
        "1W": timeframeSummary(candles1W),
        "1M": timeframeSummary(candles1M),
      },
      technicals: {
        ema20, ema50,
        macd: macd ? { value: macd.macd, signal: macd.signal, bullish: macd.macd > macd.signal } : null,
      },
      pivotLevels: pivots,
      fetchedAt: new Date().toISOString(),
      cached: false,
    };

    // Generate the AI insight ONCE here, server-side, so it gets cached
    // alongside the raw numbers — repeat requests for this coin within the
    // cache window reuse it instead of triggering a new Claude call each
    // time. Tradeoff: the insight's language matches whichever request
    // first triggered this cache miss, not each individual asker.
    result.insight = await generateInsight(result);

    cache.set(coinId, { data: result, timestamp: Date.now() });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

async function generateInsight(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  try {
    const isStablecoin = data.assetType === "stablecoin";
    const system = isStablecoin
      ? `You write ONLY a MAXIMUM 300-character, maximum-2-sentence note about a stablecoin-like asset's price stability. This is NOT a volatile crypto asset — do not use bullish/bearish trading language, do not discuss support/resistance breakouts, do not discuss "momentum" the way you would for BTC. Preserve timeframe labels EXACTLY as given (1H, 4H, 1D, 1W) — never translate them. Base everything strictly on the supplied data — if all timeframes show similar stability, say so plainly. Do not claim to know yield/APY, redemption mechanism, or backing assets — you don't have that data. Never recommend buying, selling, or holding. Output ONLY the sentence(s), no headers, no markdown.\n\nData:\n${JSON.stringify(data)}`
      : `You write ONLY a "multi-timeframe insight" for a crypto analysis card.\n\nTHREE NON-NEGOTIABLE RULES: (1) Never contradict a given trend/structure value — if it says "uptrend", don't call it weak. (2) Never conflate RSI level with trend/structure — independent numbers. (3) Only use a technical term when its exact numeric condition is genuinely met.\n\nHard limits: maximum 300 characters, maximum 2 sentences. Never end mid-sentence. Do NOT restate price, percentage changes, or specific EMA/MACD values (shown elsewhere). Preserve timeframe labels EXACTLY (1H, 4H, 1D, 1W, 1M) — never translate. If ALL timeframes share the same structure, say so explicitly rather than inventing contrast. Never infer weakness from neutral RSI (40-60). Do NOT use "divergence"/"uyumsuzluk" unless literally describing an RSI-vs-price divergence pattern. Never recommend buying, selling, or holding, never predict what will happen next. Output ONLY the sentence(s), no headers, no markdown.\n\nData:\n${JSON.stringify(data)}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 150,
        system,
        messages: [{ role: "user", content: `Analyze ${data.name}` }],
      }),
    });
    const json = await response.json();
    const raw = json.content?.[0]?.text?.trim() ?? "";
    if (raw.length <= 320) return raw;
    const truncated = raw.slice(0, 320);
    const cut = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf(".\n"));
    return cut > 50 ? truncated.slice(0, cut + 1) : truncated;
  } catch {
    return "";
  }
}

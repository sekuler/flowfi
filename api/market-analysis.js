// api/market-analysis.js
//
// Server-side market data + technical analysis engine. Runs once per coin
// per cache window (90s), no matter how many users ask — instead of every
// browser hitting CoinGecko directly (which was hitting rate limits).
//
// Returns clean, structured JSON. No AI involved here at all — this is pure
// data + math. The AI layer (Copilot) only interprets these exact numbers,
// never generates its own.
//
// GET /api/market-analysis?coinId=bitcoin

const CACHE_TTL_MS = 90 * 1000;
const cache = new Map(); // coinId -> { data, timestamp }

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

async function fetchOHLCOnce(coinId, days) {
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);
  if (!res.ok) throw new Error(`OHLC fetch failed (${res.status}) for days=${days}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`Empty OHLC for days=${days}`);
  return raw.map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
}

async function fetchOHLC(coinId, days) {
  try {
    return await fetchOHLCOnce(coinId, days);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await fetchOHLCOnce(coinId, days);
    } catch {
      return null;
    }
  }
}

function aggregateHourly(thirtyMin) {
  const hourly = [];
  for (let i = 0; i < thirtyMin.length; i += 2) {
    const chunk = thirtyMin.slice(i, i + 2);
    if (chunk.length === 0) continue;
    hourly.push({
      time: chunk[0].time, open: chunk[0].open, close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((c) => c.high)), low: Math.min(...chunk.map((c) => c.low)),
    });
  }
  return hourly;
}

function resample(daily, groupSize) {
  const groups = [];
  for (let i = 0; i < daily.length; i += groupSize) {
    const chunk = daily.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    groups.push({
      time: chunk[0].time, open: chunk[0].open, close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((c) => c.high)), low: Math.min(...chunk.map((c) => c.low)),
    });
  }
  return groups;
}

function timeframeSummary(candles) {
  if (!candles || candles.length < 5) return null;
  const closes = candles.map((c) => c.close);
  return {
    rsi: computeRSI(closes),
    structure: marketStructure(candles),
    candleCount: candles.length,
  };
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

    // Fetch all real OHLCV windows. Sequential with small gaps to be gentle
    // on CoinGecko's free tier — this whole thing is cached for 90s anyway,
    // so it only actually runs once every 90s per coin regardless of traffic.
    const ohlc1 = await fetchOHLC(coinId, "1");    // 30-min native candles -> 1H
    await new Promise((r) => setTimeout(r, 400));
    const ohlc7 = await fetchOHLC(coinId, "7");    // 4H native candles
    await new Promise((r) => setTimeout(r, 400));
    const ohlc90 = await fetchOHLC(coinId, "90");  // daily native candles -> 1D, 1W
    await new Promise((r) => setTimeout(r, 400));
    const ohlc365 = await fetchOHLC(coinId, "365"); // daily candles over a year -> 1M

    const hourly = ohlc1 ? aggregateHourly(ohlc1) : null;
    const weekly = ohlc90 ? resample(ohlc90, 7) : null;
    const monthly = ohlc365 ? resample(ohlc365, 30) : null;

    const closes1D = ohlc90 ? ohlc90.map((c) => c.close) : [];
    const ema20 = closes1D.length ? computeEMA(closes1D, 20) : null;
    const ema50 = closes1D.length ? computeEMA(closes1D, 50) : null;
    const macd = closes1D.length ? computeMACD(closes1D) : null;

    let pivots = null;
    if (ohlc90 && ohlc90.length >= 5) {
      const recent = ohlc90.slice(-30);
      const price = closes1D[closes1D.length - 1];
      pivots = pivotLevels(Math.max(...recent.map((c) => c.high)), Math.min(...recent.map((c) => c.low)), price);
    }

    const result = {
      coinId,
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
        "1H": timeframeSummary(hourly),
        "4H": timeframeSummary(ohlc7),
        "1D": timeframeSummary(ohlc90),
        "1W": timeframeSummary(weekly),
        "1M": timeframeSummary(monthly),
      },
      technicals: {
        ema20, ema50,
        macd: macd ? { value: macd.macd, signal: macd.signal, bullish: macd.macd > macd.signal } : null,
      },
      pivotLevels: pivots,
      fetchedAt: new Date().toISOString(),
      cached: false,
    };

    cache.set(coinId, { data: result, timestamp: Date.now() });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

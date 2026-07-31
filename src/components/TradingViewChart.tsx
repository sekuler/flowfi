import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, ColorType, type IChartApi } from "lightweight-charts";

interface Props {
  symbol: "BTC" | "ETH";
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const COINGECKO_ID: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum" };

async function fetchFromBinance(symbol: string): Promise<Candle[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&limit=120`);
  if (!res.ok) throw new Error("Binance request failed");
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Binance returned no data");
  return raw.map((k: any[]) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

async function fetchFromCoinGecko(symbol: string): Promise<Candle[]> {
  const id = COINGECKO_ID[symbol];
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=7`);
  if (!res.ok) throw new Error("CoinGecko request failed");
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("CoinGecko returned no data");
  return raw.map((k: number[]) => ({
    time: Math.floor(k[0] / 1000),
    open: k[1],
    high: k[2],
    low: k[3],
    close: k[4],
  }));
}

export default function TradingViewChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"binance" | "coingecko" | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6B7280",
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(109,94,247,0.06)" },
        horzLines: { color: "rgba(109,94,247,0.06)" },
      },
      rightPriceScale: { borderColor: "#D4C9FA" },
      timeScale: { borderColor: "#D4C9FA", timeVisible: true },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16A34A",
      downColor: "#DC2626",
      borderUpColor: "#16A34A",
      borderDownColor: "#DC2626",
      wickUpColor: "#16A34A",
      wickDownColor: "#DC2626",
    });

    chartRef.current = chart;
    let cancelled = false;

    async function loadCandles() {
      try {
        const candles = await fetchFromBinance(symbol);
        if (cancelled) return;
        series.setData(candles as any);
        chart.timeScale().fitContent();
        setError(null);
        setSource("binance");
      } catch {
        // Binance's public API is geo-restricted / CORS-blocked in some regions.
        // Fall back to CoinGecko so the chart still renders instead of staying blank.
        try {
          const candles = await fetchFromCoinGecko(symbol);
          if (cancelled) return;
          series.setData(candles as any);
          chart.timeScale().fitContent();
          setError(null);
          setSource("coingecko");
        } catch {
          if (!cancelled) setError("Could not load price data. Please refresh or try again shortly.");
        }
      }
    }
    loadCandles();
    const interval = setInterval(loadCandles, 30000);

    function handleResize() {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    }
    window.addEventListener("resize", handleResize);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [symbol]);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, overflow: "hidden", height: 280, padding: "0.5rem", position: "relative", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
          <p style={{ fontSize: 12, color: "#6B7280", textAlign: "center", padding: "0 1.5rem" }}>{error}</p>
        </div>
      )}
      {source === "coingecko" && !error && (
        <div style={{ position: "absolute", bottom: 6, right: 10, fontSize: 9, color: "#9CA3AF" }}>via CoinGecko</div>
      )}
    </div>
  );
}

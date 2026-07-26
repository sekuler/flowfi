import { useEffect, useRef } from "react";
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

export default function TradingViewChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.1)" },
      timeScale: { borderColor: "rgba(148,163,184,0.1)", timeVisible: true },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22d3ee",
      downColor: "#6366f1",
      borderUpColor: "#22d3ee",
      borderDownColor: "#6366f1",
      wickUpColor: "#67e8f9",
      wickDownColor: "#a5b4fc",
    });

    chartRef.current = chart;
    let cancelled = false;

    async function loadCandles() {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&limit=120`);
        const raw = await res.json();
        if (cancelled) return;
        const candles: Candle[] = raw.map((k: any[]) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));
        series.setData(candles as any);
        chart.timeScale().fitContent();
      } catch {
        /* keep chart empty on failure */
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
    <div style={{ background: "rgba(15,23,42,0.6)", backdropFilter: "blur(16px)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 14, overflow: "hidden", height: 280, padding: "0.5rem" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

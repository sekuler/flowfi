import { useEffect, useRef } from "react";

interface Props {
  symbol: "BTC" | "ETH";
}

export default function TradingViewChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [[`${symbol}USD`, `BINANCE:${symbol}USDT|1D`]],
      chartOnly: true,
      width: "100%",
      height: 280,
      locale: "en",
      colorTheme: "dark",
      autosize: true,
      showVolume: false,
      hideDateRanges: false,
      hideMarketStatus: true,
      hideSymbolLogo: true,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "Inter, sans-serif",
      fontSize: "10",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      lineColor: symbol === "BTC" ? "#f59e0b" : "#627eea",
      topColor: symbol === "BTC" ? "rgba(245,158,11,0.3)" : "rgba(98,126,234,0.3)",
      bottomColor: "rgba(0,0,0,0)",
      backgroundColor: "rgba(0,0,0,0)",
    });
    containerRef.current.appendChild(script);
  }, [symbol]);

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 14, overflow: "hidden", height: 280, boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
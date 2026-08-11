import { useState, useEffect } from "react";

interface Coin {
  id: string;
  symbol: string;
  price: number;
  change24h: number;
}

const TRACKED_COINS = ["bitcoin", "ethereum", "solana", "usd-coin", "ripple", "binancecoin"];
const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", "usd-coin": "USDC", ripple: "XRP", binancecoin: "BNB",
};

export default function MarketTicker() {
  const [coins, setCoins] = useState<Coin[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${TRACKED_COINS.join(",")}&vs_currencies=usd&include_24hr_change=true`
        );
        const data = await res.json();
        if (cancelled) return;
        const parsed: Coin[] = TRACKED_COINS.filter((id) => data[id]).map((id) => ({
          id,
          symbol: SYMBOL_MAP[id] ?? id.toUpperCase(),
          price: data[id].usd,
          change24h: data[id].usd_24h_change ?? 0,
        }));
        setCoins(parsed);
      } catch {
        // Silently skip a failed refresh — the ticker just keeps its last known values.
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (coins.length === 0) return null;

  // Duplicate the list so the CSS marquee can loop seamlessly.
  const loopCoins = [...coins, ...coins];

  return (
    <div style={{ background: "#ffffff", borderBottom: "1px solid #EDE9FE", overflow: "hidden", position: "relative", height: 36, display: "flex", alignItems: "center" }}>
      <div className="flowfi-ticker-track" style={{ display: "flex", gap: 28, whiteSpace: "nowrap", paddingLeft: 20 }}>
        {loopCoins.map((c, i) => (
          <div key={`${c.id}-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <span style={{ fontWeight: 700, color: "#111827" }}>{c.symbol}</span>
            <span className="flowfi-mono" style={{ color: "#374151" }}>
              ${c.price >= 1 ? c.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : c.price.toFixed(4)}
            </span>
            <span style={{ color: c.change24h >= 0 ? "#16A34A" : "#DC2626", fontWeight: 600 }}>
              {c.change24h >= 0 ? "▲" : "▼"} {Math.abs(c.change24h).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes flowfi-ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .flowfi-ticker-track {
          animation: flowfi-ticker-scroll 35s linear infinite;
        }
        .flowfi-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}

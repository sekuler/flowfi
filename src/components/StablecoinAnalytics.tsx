import { useState, useEffect } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "../chains";
import { useIsMobile } from "../useIsMobile";
import { Repeat, Droplet, ArrowRight as ArrowRightIcon } from "lucide-react";
import { POOL_USDC_EURC } from "../contracts";

const POOL_GET_RESERVES_ABI = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
] as const;

interface Metrics {
  usdcTotal: number;
  eurcTotal: number;
  swapPool: number;
  ammPool: number;
}

export default function StablecoinAnalytics({ onNavigate }: { onNavigate?: (tab: "swap" | "pools") => void }) {
  const isMobile = useIsMobile();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });

        const [reserveUsdc, reserveEurc] = await client.readContract({ address: POOL_USDC_EURC, abi: POOL_GET_RESERVES_ABI, functionName: "getReserves" });
        const usdcTotal = Number(formatUnits(reserveUsdc, 6));
        const eurcTotal = Number(formatUnits(reserveEurc, 6));

        setMetrics({
          usdcTotal,
          eurcTotal,
          swapPool: usdcTotal + eurcTotal,
          ammPool: usdcTotal + eurcTotal,
        });
      } catch {
        setMetrics(null);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const totalTVL = metrics ? metrics.usdcTotal + metrics.eurcTotal : null;
  const usdcPct = totalTVL && totalTVL > 0 && metrics ? (metrics.usdcTotal / totalTVL) * 100 : 0;
  const eurcPct = totalTVL && totalTVL > 0 && metrics ? (metrics.eurcTotal / totalTVL) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "linear-gradient(135deg, #f5f3ff, #ede9fe)", borderRadius: 18, padding: "1.5rem" }}>
        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 6 }}>PLATFORM STABLECOIN TVL</div>
        <div className="flowfi-mono" style={{ fontSize: 36, fontWeight: 700, color: "#111827" }}>{loading ? "..." : totalTVL !== null ? `$${totalTVL.toFixed(2)}` : "—"}</div>
        <p style={{ fontSize: 11, color: "#7c3aed", marginTop: 4 }}>Held across ArcSwap and Liquidity Pools — verifiable on-chain</p>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>DISTRIBUTION BY STABLECOIN</div>
        {loading ? (
          <div style={{ fontSize: 12, color: "#6B7280" }}>Loading...</div>
        ) : (
          <>
            <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 12, background: "#F5F3FF" }}>
              <div style={{ width: `${usdcPct}%`, background: "#7c3aed" }} />
              <div style={{ width: `${eurcPct}%`, background: "#5B21B6" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7c3aed" }} />
                <span style={{ color: "#6B7280" }}>USDC</span>
                <span style={{ color: "#111827", fontWeight: 700 }}>{totalTVL === null ? "—" : `${usdcPct.toFixed(1)}%`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#5B21B6" }} />
                <span style={{ color: "#6B7280" }}>EURC</span>
                <span style={{ color: "#111827", fontWeight: 700 }}>{totalTVL === null ? "—" : `${eurcPct.toFixed(1)}%`}</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ background: "#ffffff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>STABLECOIN HUB — SUPPORTED ON FLOWFI</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11, color: "#6B7280", fontWeight: 700, marginBottom: 6, padding: "0 0.25rem" }}>
          <span></span><span>USDC</span><span>EURC</span>
        </div>
        {[
          { label: "Swappable", usdc: "Yes", eurc: "Yes" },
          { label: "Bridgeable (CCTP)", usdc: "Yes · 4 chains", eurc: "Not yet" },
        ].map((row) => (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12.5, padding: "0.6rem 0.25rem", borderTop: "1px solid #F5F3FF" }}>
            <span style={{ color: "#374151", fontWeight: 600 }}>{row.label}</span>
            <span style={{ color: "#111827" }}>{row.usdc}</span>
            <span style={{ color: "#111827" }}>{row.eurc}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "#ffffff", borderRadius: 16, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, color: "#374151", fontWeight: 700 }}>Swap desk</div>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(124,58,237,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Repeat size={14} color="#7c3aed" />
            </div>
          </div>
          <div className="flowfi-mono" style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{loading ? "..." : metrics ? `$${metrics.swapPool.toFixed(2)}` : "—"}</div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 12 }}>Available to swap</div>
          <button onClick={() => onNavigate?.("swap")}
            style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.55rem 0.8rem", color: "#5B21B6", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            View swap desk <ArrowRightIcon size={13} />
          </button>
        </div>
        <div style={{ background: "#ffffff", borderRadius: 16, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, color: "#374151", fontWeight: 700 }}>AMM pool</div>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(91,33,182,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Droplet size={14} color="#5B21B6" />
            </div>
          </div>
          <div className="flowfi-mono" style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{loading ? "..." : metrics ? `$${metrics.ammPool.toFixed(2)}` : "—"}</div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 12 }}>Total liquidity</div>
          <button onClick={() => onNavigate?.("pools")}
            style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.55rem 0.8rem", color: "#5B21B6", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            View AMM pool <ArrowRightIcon size={13} />
          </button>
        </div>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: "0.75rem 1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <p style={{ fontSize: 11, color: "#4B5563", margin: 0 }}>
          All figures read live from on-chain contract balances — refreshes every 60 seconds. Verify any figure on{" "}
          <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" style={{ color: "#7c3aed" }}>Arc Explorer</a>.
        </p>
      </div>
    </div>
  );
}

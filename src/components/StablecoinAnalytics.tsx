import { useState, useEffect } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "../chains";

const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;
const LEGACY_AMM = "0x01ddb4902e2F22f6124Ec685540C424d1BB75E0C" as `0x${string}`;
const LENDING_CONTRACT = "0xD3e0171CaCd799E49155eE48981841E9a9d225ab" as `0x${string}`;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface Metrics {
  usdcTotal: number;
  eurcTotal: number;
  swapPool: number;
  ammPool: number;
  lendingPool: number;
}

export default function StablecoinAnalytics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });

        const contracts = [SWAP_CONTRACT, LEGACY_AMM, LENDING_CONTRACT];
        const usdcBalances = await Promise.all(
          contracts.map((c) => client.readContract({ address: USDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [c] }))
        );
        const eurcBalances = await Promise.all(
          contracts.map((c) => client.readContract({ address: EURC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [c] }))
        );

        const usdcTotal = usdcBalances.reduce((sum, b) => sum + Number(formatUnits(b, 6)), 0);
        const eurcTotal = eurcBalances.reduce((sum, b) => sum + Number(formatUnits(b, 6)), 0);

        setMetrics({
          usdcTotal,
          eurcTotal,
          swapPool: Number(formatUnits(usdcBalances[0], 6)) + Number(formatUnits(eurcBalances[0], 6)),
          ammPool: Number(formatUnits(usdcBalances[1], 6)) + Number(formatUnits(eurcBalances[1], 6)),
          lendingPool: Number(formatUnits(usdcBalances[2], 6)) + Number(formatUnits(eurcBalances[2], 6)),
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

  const totalTVL = metrics ? metrics.usdcTotal + metrics.eurcTotal : 0;
  const usdcPct = totalTVL > 0 && metrics ? (metrics.usdcTotal / totalTVL) * 100 : 0;
  const eurcPct = totalTVL > 0 && metrics ? (metrics.eurcTotal / totalTVL) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.12), rgba(124,58,237,0.08))", border: "1px solid rgba(79,70,229,0.25)", borderRadius: 18, padding: "1.5rem" }}>
        <div style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 6 }}>PLATFORM STABLECOIN TVL</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: "#f8fafc" }}>{loading ? "..." : `$${totalTVL.toFixed(2)}`}</div>
        <p style={{ fontSize: 11, color: "#818cf8", marginTop: 4 }}>Held across ArcSwap, Liquidity Pools, and ArcLending — verifiable on-chain</p>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>DISTRIBUTION BY STABLECOIN</div>
        {loading ? (
          <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>
        ) : totalTVL === 0 ? (
          <div style={{ fontSize: 12, color: "#334155" }}>No liquidity yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: `${usdcPct}%`, background: "#2563eb" }} />
              <div style={{ width: `${eurcPct}%`, background: "#7c3aed" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                <span style={{ color: "#94a3b8" }}>USDC</span>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{usdcPct.toFixed(1)}%</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7c3aed" }} />
                <span style={{ color: "#94a3b8" }}>EURC</span>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{eurcPct.toFixed(1)}%</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 14, padding: "1rem" }}>
          <div style={{ fontSize: 10, color: "#a78bfa", fontWeight: 700, marginBottom: 4 }}>SWAP POOL</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{loading ? "..." : `$${metrics?.swapPool.toFixed(2)}`}</div>
        </div>
        <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 14, padding: "1rem" }}>
          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 4 }}>AMM POOL</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{loading ? "..." : `$${metrics?.ammPool.toFixed(2)}`}</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 14, padding: "1rem" }}>
          <div style={{ fontSize: 10, color: "#6ee7b7", fontWeight: 700, marginBottom: 4 }}>LENDING POOL</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{loading ? "..." : `$${metrics?.lendingPool.toFixed(2)}`}</div>
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
          All figures read live from on-chain contract balances — refreshes every 60 seconds. Verify any figure on{" "}
          <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>Arc Explorer</a>.
        </p>
      </div>
    </div>
  );
}

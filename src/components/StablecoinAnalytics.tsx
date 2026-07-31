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
      <div style={{ background: "linear-gradient(135deg, #f5f3ff, #ede9fe)", borderRadius: 18, padding: "1.5rem" }}>
        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 6 }}>PLATFORM STABLECOIN TVL</div>
        <div className="flowfi-mono" style={{ fontSize: 36, fontWeight: 700, color: "#111827" }}>{loading ? "..." : `$${totalTVL.toFixed(2)}`}</div>
        <p style={{ fontSize: 11, color: "#7c3aed", marginTop: 4 }}>Held across ArcSwap, Liquidity Pools, and ArcLending — verifiable on-chain</p>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>DISTRIBUTION BY STABLECOIN</div>
        {loading ? (
          <div style={{ fontSize: 12, color: "#6B7280" }}>Loading...</div>
        ) : totalTVL === 0 ? (
          <div style={{ fontSize: 12, color: "#6B7280" }}>No liquidity yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: `${usdcPct}%`, background: "#7c3aed" }} />
              <div style={{ width: `${eurcPct}%`, background: "#a855f7" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7c3aed" }} />
                <span style={{ color: "#6B7280" }}>USDC</span>
                <span style={{ color: "#111827", fontWeight: 700 }}>{usdcPct.toFixed(1)}%</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7" }} />
                <span style={{ color: "#6B7280" }}>EURC</span>
                <span style={{ color: "#111827", fontWeight: 700 }}>{eurcPct.toFixed(1)}%</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "#ffffff", borderRadius: 14, padding: "1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, marginBottom: 4 }}>SWAP POOL</div>
          <div className="flowfi-mono" style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{loading ? "..." : `$${metrics?.swapPool.toFixed(2)}`}</div>
        </div>
        <div style={{ background: "#ffffff", borderRadius: 14, padding: "1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ fontSize: 10, color: "#a855f7", fontWeight: 700, marginBottom: 4 }}>AMM POOL</div>
          <div className="flowfi-mono" style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{loading ? "..." : `$${metrics?.ammPool.toFixed(2)}`}</div>
        </div>
        <div style={{ background: "#ffffff", borderRadius: 14, padding: "1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ fontSize: 10, color: "#059669", fontWeight: 700, marginBottom: 4 }}>LENDING POOL</div>
          <div className="flowfi-mono" style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{loading ? "..." : `$${metrics?.lendingPool.toFixed(2)}`}</div>
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

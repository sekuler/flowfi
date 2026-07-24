import { useState, useEffect } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet } from "../chains";

interface ChainStatus {
  name: string;
  gasPrice: string | null;
  status: "operational" | "degraded" | "checking";
  color: string;
}

const CHAINS = [
  { name: "Arc Testnet", chain: arcTestnet, color: "#4f46e5" },
  { name: "Ethereum Sepolia", chain: sepolia, color: "#627eea" },
  { name: "Base Sepolia", chain: baseSepolia, color: "#0052ff" },
  { name: "Arbitrum Sepolia", chain: arbitrumSepolia, color: "#28a0f0" },
];

export default function NetworkHealth() {
  const [statuses, setStatuses] = useState<ChainStatus[]>(
    CHAINS.map((c) => ({ name: c.name, gasPrice: null, status: "checking", color: c.color }))
  );

  useEffect(() => {
    let cancelled = false;

    async function checkChain(index: number) {
      const { chain } = CHAINS[index];
      try {
        const client = createPublicClient({ chain, transport: http() });
        const start = Date.now();
        const gasPrice = await client.getGasPrice();
        const latency = Date.now() - start;
        if (cancelled) return;
        setStatuses((prev) => prev.map((s, i) => i === index ? {
          ...s,
          gasPrice: Number(formatUnits(gasPrice, 9)).toFixed(2),
          status: latency < 3000 ? "operational" : "degraded",
        } : s));
      } catch {
        if (cancelled) return;
        setStatuses((prev) => prev.map((s, i) => i === index ? { ...s, status: "degraded", gasPrice: null } : s));
      }
    }

    CHAINS.forEach((_, i) => checkChain(i));
    const interval = setInterval(() => CHAINS.forEach((_, i) => checkChain(i)), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, letterSpacing: "1px" }}>NETWORK HEALTH</div>
        <a href="https://status.circle.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#60a5fa", textDecoration: "none" }}>Circle Status ↗</a>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {statuses.map((s) => (
          <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{s.name}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {s.gasPrice && <span style={{ fontSize: 11, color: "#64748b" }}>{s.gasPrice} gwei</span>}
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                color: s.status === "operational" ? "#6ee7b7" : s.status === "degraded" ? "#fca5a5" : "#64748b",
                background: s.status === "operational" ? "rgba(16,185,129,0.1)" : s.status === "degraded" ? "rgba(239,68,68,0.1)" : "rgba(100,116,139,0.1)",
              }}>
                {s.status === "operational" ? "Healthy" : s.status === "degraded" ? "Slow" : "..."}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

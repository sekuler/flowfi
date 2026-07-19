import { useState, useEffect } from "react";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet } from "../chains";

interface Props {
  address: string;
}

interface ChainBalance {
  name: string;
  balance: string | null;
  color: string;
  explorerTx: string;
}

const CHAINS = [
  { name: "Arc Testnet", chain: arcTestnet, usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`, color: "#4f46e5", explorer: "https://testnet.arcscan.app/address/" },
  { name: "Ethereum Sepolia", chain: sepolia, usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as `0x${string}`, color: "#627eea", explorer: "https://sepolia.etherscan.io/address/" },
  { name: "Base Sepolia", chain: baseSepolia, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, color: "#0052ff", explorer: "https://sepolia.basescan.org/address/" },
  { name: "Arbitrum Sepolia", chain: arbitrumSepolia, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`, color: "#28a0f0", explorer: "https://sepolia.arbiscan.io/address/" },
];

export default function UnifiedBalance({ address }: Props) {
  const [balances, setBalances] = useState<ChainBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const results: ChainBalance[] = [];
      for (const c of CHAINS) {
        try {
          const client = createPublicClient({ chain: c.chain, transport: http() });
          const raw = await client.readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
          results.push({ name: c.name, balance: Number(formatUnits(raw, 6)).toFixed(2), color: c.color, explorerTx: c.explorer + address });
        } catch {
          results.push({ name: c.name, balance: "—", color: c.color, explorerTx: c.explorer + address });
        }
        await new Promise(r => setTimeout(r, 300));
      }
      setBalances(results);
      setLoading(false);
    }
    if (address) loadAll();
  }, [address]);

  const total = balances.reduce((sum, b) => sum + (b.balance && b.balance !== "—" ? Number(b.balance) : 0), 0);

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px" }}>UNIFIED USDC BALANCE</div>
        {!loading && <div style={{ fontSize: 13, color: "#a5b4fc", fontWeight: 700 }}>${total.toFixed(2)} total</div>}
      </div>

      {loading && <div style={{ fontSize: 12, color: "#334155" }}>Checking balances across chains...</div>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {balances.map((b) => (
            <a key={b.name} href={b.explorerTx} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.8rem", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.color }} />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{b.name}</span>
              </div>
              <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{b.balance === null ? "..." : `${b.balance} USDC`}</span>
            </a>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: "#334155" }}>
        Bridge any of these to Arc using CCTP from the Bridge tab.
      </div>
    </div>
  );
}
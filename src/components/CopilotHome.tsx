import NetworkHealth from "./NetworkHealth";
import { useState, useEffect } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "../chains";

const PERPS_CONTRACT = "0x3B4cE1734087e1c67474Ff42982063febE3E4B20" as `0x${string}`;
const LENDING_CONTRACT = "0xD3e0171CaCd799E49155eE48981841E9a9d225ab" as `0x${string}`;

const PERPS_ABI = [
  { type: "function", name: "getUserPositions", stateMutability: "view", inputs: [{ name: "trader", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
  { type: "function", name: "getPosition", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [
    { name: "trader", type: "address" }, { name: "isLong", type: "bool" }, { name: "margin", type: "uint256" },
    { name: "leverage", type: "uint256" }, { name: "entryPrice", type: "uint256" }, { name: "exitPrice", type: "uint256" },
    { name: "pnl", type: "int256" }, { name: "status", type: "uint8" }, { name: "openedAt", type: "uint256" }, { name: "market", type: "string" },
  ] },
] as const;

const LENDING_ABI = [
  { type: "function", name: "currentAPR", stateMutability: "view", inputs: [], outputs: [{ name: "bps", type: "uint256" }] },
  { type: "function", name: "supplyBalance", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onNavigate: (tab: "swap" | "bridge" | "send" | "perps" | "lending" | "pools") => void;
}

interface OpenPosition {
  market: string;
  isLong: boolean;
  pnl: number;
  marginNum: number;
  entryPriceNum: number;
  leverage: number;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function CopilotHome({ address, balances, onNavigate }: Props) {
  const [openPosition, setOpenPosition] = useState<OpenPosition | null>(null);
  const [lendingAPR, setLendingAPR] = useState<string | null>(null);
  const [supplyBalance, setSupplyBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });

        const ids = await client.readContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "getUserPositions", args: [address as `0x${string}`] });
        for (const id of (ids as bigint[]).slice().reverse()) {
          const p = await client.readContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "getPosition", args: [id] });
          const [, isLong, marginRaw, leverage, entry, , , status, , market] = p as any;
          if (Number(status) === 0) {
            const marginNum = Number(formatUnits(marginRaw, 6));
            const entryPriceNum = Number(formatUnits(entry, 6));
            const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd");
            const priceData = await priceRes.json();
            const currentPrice = market === "BTC" ? priceData.bitcoin?.usd : priceData.ethereum?.usd;
            let pnl = 0;
            if (currentPrice) {
              const size = marginNum * Number(leverage);
              const diff = isLong ? currentPrice - entryPriceNum : entryPriceNum - currentPrice;
              pnl = (size * diff) / entryPriceNum;
            }
            setOpenPosition({ market, isLong, pnl, marginNum, entryPriceNum, leverage: Number(leverage) });
            break;
          }
        }

        const apr = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "currentAPR" });
        setLendingAPR((Number(apr) / 100).toFixed(2));
        const supBal = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "supplyBalance", args: [address as `0x${string}`] });
        setSupplyBalance(Number(formatUnits(supBal, 6)).toFixed(2));
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    }
    if (address) load();
  }, [address]);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcVal = Number(balances.eurc ?? 0);
  const hasIdleFunds = usdcVal > 10 && Number(supplyBalance ?? 0) === 0;

  const suggestions: { text: string; action: () => void }[] = [];
  if (hasIdleFunds) suggestions.push({ text: `Supply your idle ${usdcVal.toFixed(0)} USDC to earn ${lendingAPR ?? "..."}% APY`, action: () => onNavigate("lending") });
  if (openPosition && openPosition.pnl > 0) suggestions.push({ text: `Your ${openPosition.market} position is up $${openPosition.pnl.toFixed(2)} — consider taking profit`, action: () => onNavigate("perps") });
  if (openPosition && openPosition.pnl < 0) suggestions.push({ text: `Your ${openPosition.market} position is down $${Math.abs(openPosition.pnl).toFixed(2)} — review your risk`, action: () => onNavigate("perps") });
  if (eurcVal > 5) suggestions.push({ text: `You're holding ${eurcVal.toFixed(0)} EURC — swap or use it as lending collateral`, action: () => onNavigate("swap") });
  if (suggestions.length === 0) suggestions.push({ text: "Explore Liquidity Pools to start earning swap fees", action: () => onNavigate("pools") });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", marginBottom: 4 }}>
          {greeting()}.
        </h1>
        <p style={{ fontSize: 13, color: "#64748b" }}>Here's what's happening with your portfolio on Arc.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 14, padding: "1.1rem" }}>
          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>YOU HOLD</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{balances.usdc ?? "..."} <span style={{ fontSize: 13, color: "#64748b" }}>USDC</span></div>
        </div>
        <div style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 14, padding: "1.1rem" }}>
          <div style={{ fontSize: 10, color: "#a78bfa", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>YOU HOLD</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{balances.eurc ?? "..."} <span style={{ fontSize: 13, color: "#64748b" }}>EURC</span></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div onClick={() => onNavigate("perps")} style={{ cursor: "pointer", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>OPEN POSITION</div>
          {loading ? (
            <div style={{ fontSize: 14, color: "#64748b" }}>Loading...</div>
          ) : openPosition ? (
            <>
              <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700, marginBottom: 2 }}>{openPosition.market} {openPosition.isLong ? "Long" : "Short"} {openPosition.leverage}x</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: openPosition.pnl >= 0 ? "#6ee7b7" : "#fca5a5" }}>{openPosition.pnl >= 0 ? "+" : ""}${openPosition.pnl.toFixed(2)}</div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: "#475569" }}>None</div>
          )}
        </div>
        <div onClick={() => onNavigate("lending")} style={{ cursor: "pointer", background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 14, padding: "1.1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>LENDING APY</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#6ee7b7" }}>{loading ? "..." : `${lendingAPR ?? "0.00"}%`}</div>
          {Number(supplyBalance ?? 0) > 0 && <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Supplying {supplyBalance} USDC</div>}
        </div>
      </div>

      <div style={{ background: "rgba(79,70,229,0.05)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 14, padding: "1.1rem" }}>
        <div style={{ fontSize: 10, color: "#a5b4fc", fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>SUGGESTIONS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={s.action}
              style={{ textAlign: "left", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.7rem 0.9rem", color: "#cbd5e1", fontSize: 13, cursor: "pointer" }}>
              • {s.text}
            </button>
          ))}
        </div>
      </div>
      <NetworkHealth />
    </div>
  );
}

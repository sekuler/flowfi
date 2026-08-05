import NetworkHealth from "./NetworkHealth";
import { useState, useEffect, useRef } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "../chains";
import { showToast } from "../toast";
import { getRules, addRule, removeRule, type AutomationRule } from "../automation";
import { computeMemoryInsight, type MemoryInsight } from "../memory";
import {
  Repeat, Hexagon, Rocket, Droplet, Sparkles, TrendingUp,
  ChevronRight, ArrowUpRight, ExternalLink, ShieldCheck, Brain,
} from "lucide-react";

const PERPS_CONTRACT = "0x3B4cE1734087e1c67474Ff42982063febE3E4B20" as `0x${string}`;
const LENDING_CONTRACT = "0xD3e0171CaCd799E49155eE48981841E9a9d225ab" as `0x${string}`;
const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;
const LEGACY_AMM = "0x01ddb4902e2F22f6124Ec685540C424d1BB75E0C" as `0x${string}`;
const POOL_FACTORY = "0xE610D2f76547c2a3073e1273E7BFA80d395eCDf8" as `0x${string}`;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;

const PERPS_ABI = [
  { type: "function", name: "getUserPositions", stateMutability: "view", inputs: [{ name: "trader", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
] as const;

const LENDING_ABI = [
  { type: "function", name: "currentAPR", stateMutability: "view", inputs: [], outputs: [{ name: "bps", type: "uint256" }] },
] as const;

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const POOL_FACTORY_ABI = [
  { type: "function", name: "allPoolsLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onNavigate: (tab: "swap" | "bridge" | "send" | "perps" | "lending" | "pools" | "launch") => void;
}

interface RecentTx {
  hash: string;
  method: string;
  age: string;
}

const TOKEN_META: Record<string, { color: string; letter: string; name: string }> = {
  USDC: { color: "#3B82F6", letter: "$", name: "USD Coin" },
  EURC: { color: "#22C55E", letter: "€", name: "Euro Coin" },
  USYC: { color: "#F59E0B", letter: "Y", name: "Circle Yield" },
};

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Sparkline({ color, seed }: { color: string; seed: number }) {
  const points = Array.from({ length: 16 }, (_, i) => {
    const v = 50 + Math.sin(i * 0.6 + seed) * 20 + i * 1.5;
    return `${(i * 100) / 15},${40 - (v / 100) * 36}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: "100%", height: 40 }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const QUICK_ACTIONS = [
  { id: "swap" as const, label: "Swap Tokens", desc: "Exchange tokens instantly", Icon: Repeat },
  { id: "bridge" as const, label: "Bridge", desc: "Transfer assets across chains", Icon: Hexagon },
  { id: "launch" as const, label: "Launch Token", desc: "Create your own token", Icon: Rocket },
  { id: "pools" as const, label: "Add Liquidity", desc: "Provide liquidity to earn fees", Icon: Droplet },
];

export default function CopilotHome({ address, balances, onNavigate }: Props) {
  const [openPositionCount, setOpenPositionCount] = useState<number | null>(null);
  const [memoryInsight, setMemoryInsight] = useState<MemoryInsight | null>(null);
  const [lendingAPR, setLendingAPR] = useState<string | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [tvl, setTvl] = useState<number | null>(null);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });

        const [ids, apr, poolsLen, usdcSwap, eurcSwap, usdcAmm, eurcAmm, usdcLend, eurcLend] = await Promise.all([
          client.readContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "getUserPositions", args: [address as `0x${string}`] }).catch(() => []),
          client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "currentAPR" }).catch(() => 0n),
          client.readContract({ address: POOL_FACTORY, abi: POOL_FACTORY_ABI, functionName: "allPoolsLength" }).catch(() => 0n),
          client.readContract({ address: USDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [SWAP_CONTRACT] }).catch(() => 0n),
          client.readContract({ address: EURC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [SWAP_CONTRACT] }).catch(() => 0n),
          client.readContract({ address: USDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [LEGACY_AMM] }).catch(() => 0n),
          client.readContract({ address: EURC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [LEGACY_AMM] }).catch(() => 0n),
          client.readContract({ address: USDC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [LENDING_CONTRACT] }).catch(() => 0n),
          client.readContract({ address: EURC_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [LENDING_CONTRACT] }).catch(() => 0n),
        ]);

        setOpenPositionCount((ids as bigint[]).length);
        setLendingAPR((Number(apr) / 100).toFixed(2));
        setPoolCount(Number(poolsLen) + 1);
        setTvl(
          Number(formatUnits(usdcSwap, 6)) + Number(formatUnits(eurcSwap, 6)) +
          Number(formatUnits(usdcAmm, 6)) + Number(formatUnits(eurcAmm, 6)) +
          Number(formatUnits(usdcLend, 6)) + Number(formatUnits(eurcLend, 6))
        );

        const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=4`);
        const data = await res.json();
        const items: RecentTx[] = (data.result ?? []).slice(0, 4).map((tx: any) => ({
          hash: tx.hash,
          method: tx.methodId === "0x" ? "Contract Deploy" : (tx.methodId && tx.methodId !== "0x" ? "Transaction" : "Transfer"),
          age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
        }));
        setRecentTxs(items);
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    }
    if (address) load();
  }, [address]);

  useEffect(() => {
    if (address) computeMemoryInsight(address).then(setMemoryInsight);
  }, [address]);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcVal = Number(balances.eurc ?? 0);
  const usycVal = Number(balances.usyc ?? 0);
  const totalValue = usdcVal + eurcVal + usycVal;
  const hasIdleFunds = usdcVal > 10;
  const estYield = hasIdleFunds && lendingAPR ? (usdcVal * Number(lendingAPR)) / 100 : 0;

  // Simple, real (not fabricated) concentration-based risk score: a portfolio
  // sitting 100% in one asset scores riskier than one spread across several.
  const riskScore = (() => {
    if (totalValue === 0) return null;
    const shares = [usdcVal, eurcVal, usycVal].filter((v) => v > 0).map((v) => v / totalValue);
    const herfindahl = shares.reduce((sum, s) => sum + s * s, 0); // 1 = fully concentrated, lower = more diversified
    return Math.round(herfindahl * 10);
  })();

  // Pushes a one-time-per-session notification when there's a clear, real action
  // available (idle USDC that could be earning yield) — not a spammy repeat.
  const notifiedIdleRef = useRef(false);
  useEffect(() => {
    if (hasIdleFunds && lendingAPR && !notifiedIdleRef.current) {
      notifiedIdleRef.current = true;
      showToast(`You have ${usdcVal.toFixed(0)} idle USDC. Supplying it to Lending could earn ${lendingAPR}% APY.`, "info");
    }
  }, [hasIdleFunds, lendingAPR, usdcVal]);

  const assets = [
    { symbol: "USDC", amount: balances.usdc, usd: usdcVal },
    { symbol: "EURC", amount: balances.eurc, usd: eurcVal },
    { symbol: "USYC", amount: balances.usyc, usd: usycVal },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 8 }}>Total Portfolio Value</div>
          <div className="flowfi-mono" style={{ fontSize: 28, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
            {loading ? "..." : `$${totalValue.toFixed(2)}`}
          </div>
          <Sparkline color="#6D5EF7" seed={1} />
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 8 }}>Total Value Locked</div>
          <div className="flowfi-mono" style={{ fontSize: 28, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
            {loading || tvl === null ? "..." : `$${tvl.toFixed(0)}`}
          </div>
          <Sparkline color="#6D5EF7" seed={2} />
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 8 }}>Active Pools</div>
            <div className="flowfi-mono" style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>
              {loading || poolCount === null ? "..." : poolCount}
            </div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "flex-end" }}>
            <Droplet size={18} color="#6D5EF7" />
          </div>
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 8 }}>Open Positions</div>
            <div className="flowfi-mono" style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>
              {loading || openPositionCount === null ? "..." : openPositionCount}
            </div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "flex-end" }}>
            <TrendingUp size={18} color="#6D5EF7" />
          </div>
        </div>
      </div>

      {/* Assets / AI Advisor / Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.3fr 1fr", gap: "1rem", alignItems: "start" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Your Assets</div>
            <button onClick={() => onNavigate("swap")} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
              View Portfolio <ArrowUpRight size={13} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {assets.map((a) => {
              const meta = TOKEN_META[a.symbol];
              return (
                <div key={a.symbol} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: meta.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                      {meta.letter}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{a.symbol}</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>{meta.name}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{a.amount ?? "..."}</div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>${a.usd.toFixed(2)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {riskScore !== null && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F5F3FF", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11.5, color: "#6B7280" }}>Concentration Risk</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: riskScore >= 8 ? "#DC2626" : riskScore >= 5 ? "#B45309" : "#16A34A" }}>
                {riskScore}/10 {riskScore >= 8 ? "· concentrated" : riskScore >= 5 ? "· moderate" : "· diversified"}
              </span>
            </div>
          )}
        </div>

        <div style={{ background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Sparkles size={16} color="#6D5EF7" />
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>AI Advisor</div>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#6D5EF7", background: "#ffffff", padding: "2px 7px", borderRadius: 999 }}>BETA</span>
          </div>
          <div style={{ background: "#ffffff", borderRadius: 16, padding: "1rem", textAlign: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
              <Sparkles size={18} color="#6D5EF7" />
            </div>
            {hasIdleFunds ? (
              <>
                <p style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}>You have <b>{usdcVal.toFixed(0)} USDC</b> idle in your wallet.</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12 }}>Supply it to Lending to earn {lendingAPR ?? "..."}% APY.</p>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>Estimated Annual Yield</div>
                <div className="flowfi-mono" style={{ fontSize: 20, fontWeight: 700, color: "#6D5EF7", marginBottom: 2 }}>+${estYield.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 14 }}>({lendingAPR ?? "..."}% APY)</div>
                <button onClick={() => onNavigate("lending")} style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Review Opportunity
                </button>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#4B5563" }}>Explore Swap, Bridge, and Lending — Copilot will surface suggestions here as you build activity.</p>
            )}
          </div>
          <p style={{ fontSize: 10, color: "#6B7280", textAlign: "center", marginTop: 10 }}>AI suggestions are for reference only.</p>
          {memoryInsight && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #EDE9FE", display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Brain size={13} color="#6D5EF7" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 11, color: "#5B21B6", margin: 0, lineHeight: 1.5 }}>{memoryInsight.text}</p>
            </div>
          )}
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Quick Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {QUICK_ACTIONS.map(({ id, label, desc, Icon }) => (
              <button key={id} onClick={() => onNavigate(id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.6rem", borderRadius: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={16} color="#6D5EF7" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>{label}</div>
                  <div style={{ fontSize: 10.5, color: "#6B7280" }}>{desc}</div>
                </div>
                <ChevronRight size={14} color="#c4b5fd" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <AutomationCard usdcVal={usdcVal} onNavigate={onNavigate} />

      {/* Market Overview / Recent Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem", alignItems: "start" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Market Overview</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>TVL</div>
              <div className="flowfi-mono" style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 6 }}>{tvl === null ? "..." : `$${tvl.toFixed(0)}`}</div>
              <Sparkline color="#6D5EF7" seed={3} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>Pools</div>
              <div className="flowfi-mono" style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 6 }}>{poolCount ?? "..."}</div>
              <Sparkline color="#6D5EF7" seed={4} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>Lending APY</div>
              <div className="flowfi-mono" style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 6 }}>{lendingAPR ?? "..."}%</div>
              <Sparkline color="#6D5EF7" seed={5} />
            </div>
          </div>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Recent Activity</div>
            <ExternalLink size={13} color="#6D5EF7" />
          </div>
          {recentTxs.length === 0 && <div style={{ fontSize: 12, color: "#6B7280" }}>No recent activity yet.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recentTxs.map((tx) => (
              <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem", textDecoration: "none" }}>
                <span style={{ fontSize: 12.5, color: "#374151" }}>{tx.method}</span>
                <span style={{ fontSize: 11, color: "#6B7280" }}>{tx.age}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <NetworkHealth />

      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <ShieldCheck size={18} color="#6D5EF7" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Your assets are secured by smart contracts</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>FlowFi is non-custodial and built on Arc Testnet.</div>
        </div>
      </div>
    </div>
  );
}

function AutomationCard({ usdcVal, onNavigate }: { usdcVal: number; onNavigate: (tab: "lending") => void }) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [threshold, setThreshold] = useState("1000");
  const [lendAmount, setLendAmount] = useState("500");

  useEffect(() => { setRules(getRules()); }, []);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Automation Rules</div>
        <button onClick={() => setShowForm(!showForm)} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {showForm ? "Cancel" : "+ New Rule"}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "#6B7280", margin: "0 0 10px 0" }}>
        Checked whenever your balances refresh — this reminds you, it doesn't act on its own without your confirmation.
      </p>

      {showForm && (
        <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.8rem", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#374151" }}>IF my USDC balance is above</div>
          <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)}
            style={{ background: "#ffffff", border: "none", borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: 12, color: "#111827", outline: "none" }} />
          <div style={{ fontSize: 12, color: "#374151" }}>THEN remind me to supply to Lending</div>
          <input type="number" value={lendAmount} onChange={(e) => setLendAmount(e.target.value)}
            style={{ background: "#ffffff", border: "none", borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: 12, color: "#111827", outline: "none" }} />
          <button onClick={() => {
            if (!threshold || !lendAmount) return;
            addRule({ condition: "usdc_above", conditionValue: Number(threshold), action: "lend", actionAmount: Number(lendAmount) });
            setRules(getRules());
            setShowForm(false);
          }} style={{ padding: "0.5rem", borderRadius: 8, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Save Rule
          </button>
        </div>
      )}

      {rules.length === 0 && !showForm && (
        <div style={{ fontSize: 11.5, color: "#9CA3AF", textAlign: "center", padding: "0.5rem 0" }}>No automation rules yet.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rules.map((rule) => {
          const conditionMet = usdcVal > rule.conditionValue;
          return (
            <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: conditionMet ? "rgba(34,197,94,0.1)" : "#f5f3ff", borderRadius: 10, padding: "0.6rem 0.8rem" }}>
              <span style={{ fontSize: 11.5, color: "#111827" }}>
                IF USDC &gt; {rule.conditionValue} → lend {rule.actionAmount}
                {conditionMet && <span style={{ color: "#16A34A", fontWeight: 700, marginLeft: 6 }}>· active</span>}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {conditionMet && (
                  <button onClick={() => onNavigate("lending")} style={{ fontSize: 10.5, fontWeight: 700, color: "#16A34A", background: "none", border: "none", cursor: "pointer" }}>Go</button>
                )}
                <button onClick={() => { removeRule(rule.id); setRules(getRules()); }} style={{ background: "none", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 12 }}>×</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

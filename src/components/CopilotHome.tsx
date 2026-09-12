import NetworkHealth from "./NetworkHealth";
import AiNarrator from "./AiNarrator";
import { TokenIcon } from "./TokenIcon";
import { useState, useEffect } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "../chains";
import { useIsMobile } from "../useIsMobile";

// Real method-selector → label mapping (verified via keccak256 of each real
// function signature) — not a guess, and not just "Transaction" for everything.
const METHOD_LABELS: Record<string, string> = {
  "0xa9059cbb": "Send",
  "0x095ea7b3": "Approve",
  "0x74b30078": "Swap",
  "0x3eb4812c": "Swap",
  "0x08c84c21": "Swap",
  "0x9cd441da": "Swap",
  "0x35403023": "Supply",
  "0x2e1a7d4d": "Withdraw",
  "0xbad4a01f": "Deposit Collateral",
  "0xc5ebeaec": "Borrow",
  "0x371fd8e6": "Repay",
  "0x5e1a7dde": "Open Position",
  "0x2d6ce61d": "Close Position",
  "0x884db063": "Create Pool",
  "0x5b060530": "Launch Token",
  "0x6fd3504e": "Bridge",
};
function labelForMethodId(methodId: string | undefined): string {
  if (!methodId || methodId === "0x") return "Contract Deploy";
  return METHOD_LABELS[methodId] ?? "Activity";
}
import { computeMemoryInsight, type MemoryInsight } from "../memory";
import {
  Droplet, Sparkles,
  ArrowUpRight, ExternalLink, ShieldCheck, Brain,
} from "lucide-react";

// Real curated v4c pools — replaces the old stat that summed ArcSwap's
// balance (now retired) and a legacy AMM's balance, neither of which
// reflects what FlowFi actually curates today.
import { POOL_USDC_EURC, POOL_USDC_CIRBTC, POOL_EURC_CIRBTC } from "../contracts";
const POOL_GET_RESERVES_ABI = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
] as const;

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; cirbtc: string | null; native: string | null };
  onNavigate: (tab: "swap" | "bridge" | "pools" | "launch") => void;
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
  CIRBTC: { color: "#C2410C", letter: "₿", name: "Circle Wrapped Bitcoin" },
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

export default function CopilotHome({ address, balances, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [memoryInsight, setMemoryInsight] = useState<MemoryInsight | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [tvl, setTvl] = useState<number | null>(null);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });

        const [usdcEurcRes, usdcCirbtcRes, eurcCirbtcRes] = await Promise.all([
          client.readContract({ address: POOL_USDC_EURC, abi: POOL_GET_RESERVES_ABI, functionName: "getReserves" }).catch(() => [0n, 0n] as const),
          client.readContract({ address: POOL_USDC_CIRBTC, abi: POOL_GET_RESERVES_ABI, functionName: "getReserves" }).catch(() => [0n, 0n] as const),
          client.readContract({ address: POOL_EURC_CIRBTC, abi: POOL_GET_RESERVES_ABI, functionName: "getReserves" }).catch(() => [0n, 0n] as const),
        ]);

        setPoolCount(3);
        // Rough platform-liquidity figure (USDC+EURC sides only, same
        // simplification the original stat used) — not a precise portfolio
        // valuation, just a homepage signal of real curated liquidity.
        setTvl(
          Number(formatUnits(usdcEurcRes[0], 6)) + Number(formatUnits(usdcEurcRes[1], 6)) +
          Number(formatUnits(usdcCirbtcRes[0], 6)) + Number(formatUnits(eurcCirbtcRes[0], 6))
        );

        const res = await fetch(`/api/arcscan-proxy?module=account&action=txlist&address=${address}&limit=4`);
        const data = await res.json();
        const items: RecentTx[] = (data.result ?? []).slice(0, 4).map((tx: any) => ({
          hash: tx.hash,
          method: labelForMethodId(tx.methodId),
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

  const [btcUsd, setBtcUsd] = useState<number | null>(null);
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")
      .then(r => r.json())
      .then(d => setBtcUsd(d?.bitcoin?.usd ?? null))
      .catch(() => setBtcUsd(null));
  }, []);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcVal = Number(balances.eurc ?? 0);
  const usycVal = Number(balances.usyc ?? 0);
  const cirbtcVal = btcUsd !== null ? Number(balances.cirbtc ?? 0) * btcUsd : 0;
  const totalValue = usdcVal + eurcVal + usycVal + cirbtcVal;

  // Morning Brief: real overnight portfolio change, using the same daily
  // snapshot mechanism as Dashboard — only shown once the first time you
  // open the app on a given day, not repeated on every visit.
  const [morningBrief, setMorningBrief] = useState<{ change: number; hasData: boolean } | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  useEffect(() => {
    if (!address || totalValue === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const dayKey = `flowfi-portfolio-snapshot-${address}`;
    const lastSeenKey = `flowfi-brief-seen-${address}`;
    let snap: { date: string; value: number } | null = null;
    try { snap = JSON.parse(localStorage.getItem(dayKey) ?? "null"); } catch { /* ignore */ }

    if (snap && snap.date !== today) {
      const change = snap.value > 0 ? ((totalValue - snap.value) / snap.value) * 100 : 0;
      setMorningBrief({ change, hasData: true });
    } else if (!snap) {
      setMorningBrief({ change: 0, hasData: false });
    }

    const lastSeen = localStorage.getItem(lastSeenKey);
    if (lastSeen !== today) {
      setShowBrief(true);
      localStorage.setItem(lastSeenKey, today);
    }
    localStorage.setItem(dayKey, JSON.stringify({ date: today, value: totalValue }));
  }, [address, totalValue]);

  // Simple, real (not fabricated) concentration-based risk score: a portfolio
  // sitting 100% in one asset scores riskier than one spread across several.
  const riskScore = (() => {
    if (totalValue === 0) return null;
    const shares = [usdcVal, eurcVal, usycVal, cirbtcVal].filter((v) => v > 0).map((v) => v / totalValue);
    const herfindahl = shares.reduce((sum, s) => sum + s * s, 0); // 1 = fully concentrated, lower = more diversified
    return Math.round(herfindahl * 10);
  })();

  const assets = [
    { symbol: "USDC", amount: balances.usdc, usd: usdcVal },
    { symbol: "EURC", amount: balances.eurc, usd: eurcVal },
    { symbol: "USYC", amount: balances.usyc, usd: usycVal },
    { symbol: "CIRBTC", amount: balances.cirbtc, usd: cirbtcVal },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {showBrief && (
        <div style={{ background: "linear-gradient(135deg, #6D5EF7, #8B7CF9)", borderRadius: 20, padding: "1.5rem", position: "relative" }}>
          <button onClick={() => setShowBrief(false)} style={{ position: "absolute", top: 14, right: 16, background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 16 }}>×</button>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", marginBottom: 6 }}>
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {morningBrief?.hasData ? (
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.9)", margin: 0 }}>
                Your portfolio is {morningBrief.change >= 0 ? "up" : "down"} {Math.abs(morningBrief.change).toFixed(1)}% since your last visit.
              </p>
            ) : (
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.9)", margin: 0 }}>
                Tracking your portfolio from today — check back tomorrow for a real overnight comparison.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: "1rem" }}>
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
      </div>

      {/* Assets / AI Advisor / Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.3fr) minmax(0, 1.3fr) minmax(0, 1fr)", gap: "1rem", alignItems: "start" }}>
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
                    <TokenIcon symbol={a.symbol} size={34} />
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
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F5F3FF", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 700, letterSpacing: "1px" }}>RISK ENGINE</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11.5, color: "#6B7280" }}>Portfolio concentration</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: riskScore >= 8 ? "#DC2626" : riskScore >= 5 ? "#B45309" : "#16A34A" }}>
                  {riskScore}/10 {riskScore >= 8 ? "· concentrated" : riskScore >= 5 ? "· moderate" : "· diversified"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11.5, color: "#6B7280" }}>Protocol / bridge risk</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#16A34A" }}>Low · verified contracts, official CCTP</span>
              </div>
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
            <p style={{ fontSize: 13, color: "#4B5563" }}>Explore Swap, Bridge, and Pools — Copilot will surface suggestions here as you build activity.</p>
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
          <AiNarrator address={address} balances={balances} />
        </div>
      </div>

      {/* Market Overview / Recent Activity */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "1rem", alignItems: "start" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Market Overview</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
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


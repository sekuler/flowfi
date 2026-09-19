import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { TokenIcon } from "./TokenIcon";
import NetworkGuard from "./NetworkGuard";
import { useIsMobile } from "../useIsMobile";
import { getFormattedMarketAnalysis } from "../marketData";
import { Sparkles, ArrowUpRight, ShieldCheck } from "lucide-react";

// Mainnet counterpart to CopilotHome.tsx (which stays as-is, Arc Testnet
// only). Deliberately narrower scope, per explicit decisions:
//   - "Total Value Locked" / "Active Pools" cards are gone entirely, not
//     replaced -- they read FlowFi's own testnet pool contracts, and
//     there is no mainnet equivalent (Pools was never ported, see
//     SECURITY.md's "Mainnet trust model").
//   - "AI Advisor" now does real token/market analysis (RSI, EMA, MACD,
//     etc.) via the same getFormattedMarketAnalysis() testnet's AiNarrator
//     uses -- this is chain-agnostic (CoinGecko/DropsTab data, nothing
//     Arc-specific), so it's genuinely fine to bring back here, unlike
//     wallet-activity Q&A (which testnet's AiNarrator also does by reading
//     Arc Testnet's arcscan-proxy -- deliberately NOT duplicated here,
//     since Recent Activity below already covers that for Mainnet).
//   - Recent Activity reads Arc Mainnet via arcscan-proxy's
//     `network=mainnet` routing (Etherscan's arc.etherscan.io), same
//     pattern as DashboardMainnet.tsx.
const METHOD_LABELS: Record<string, string> = {
  "0xa9059cbb": "Send",
  "0x095ea7b3": "Approve",
};
function labelForMethodId(methodId: string | undefined): string {
  if (!methodId || methodId === "0x") return "Contract Deploy";
  return METHOD_LABELS[methodId] ?? "Activity";
}

interface Props {
  address: string;
  balances: { usdc: string | null; native: string | null };
  onNavigate: (tab: "mainnetbridge" | "mainnetswap") => void;
  provider?: EIP1193Provider;
}

interface RecentTx {
  hash: string;
  method: string;
  age: string;
}

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ANALYSIS_SECTION_HEADERS = new Set([
  "TIMEFRAME", "KEY LEVELS", "MULTI-TIMEFRAME INSIGHT", "WHAT TO WATCH",
  "Tokenomics", "Token Vesting & Unlocks", "PRICE STABILITY", "STABILITY NOTE", "Supply",
]);

// Compact version of AiNarrator's analysis renderer, sized for this card
// rather than a full chat panel.
function renderAnalysis(content: string) {
  const lines = content.split("\n");
  return (
    <div style={{ textAlign: "left" }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (i === 0) return <div key={i} style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{line}</div>;
        if (i === 1 && line.startsWith("$")) return <div key={i} className="flowfi-mono" style={{ fontSize: 16, fontWeight: 800, color: "#6D5EF7", marginBottom: 4 }}>{line}</div>;
        if (ANALYSIS_SECTION_HEADERS.has(trimmed)) return <div key={i} style={{ marginTop: 8, fontSize: 10, fontWeight: 800, color: "#6D5EF7", textTransform: "uppercase", letterSpacing: 0.5 }}>{trimmed}</div>;
        if (trimmed.startsWith("⚠️")) return <div key={i} style={{ marginTop: 6, fontSize: 10, color: "#9CA3AF" }}>{line}</div>;
        if (!trimmed) return <div key={i} style={{ height: 2 }} />;
        return <div key={i} style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{line}</div>;
      })}
    </div>
  );
}

export default function CopilotHomeMainnet({ address, balances, onNavigate, provider }: Props) {
  const isMobile = useIsMobile();
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  async function askAdvisor() {
    if (!query.trim() || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      const result = await getFormattedMarketAnalysis(query.trim());
      if (result) {
        setAnalysis(result);
      } else {
        setAnalysisError("Couldn't find that token — try a name like \"analyze BTC\" or \"analyze Arc\".");
      }
    } catch {
      setAnalysisError("Something went wrong. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/arcscan-proxy?network=mainnet&module=account&action=txlist&address=${address}&limit=4`);
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

  const usdcVal = Number(balances.usdc ?? 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <NetworkGuard provider={provider} />
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EDE9FE", color: "#6D5EF7", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, alignSelf: "flex-start" }}>
        ⚡ MAINNET — real funds, self-custody
      </div>

      <div style={{ background: "linear-gradient(135deg, #EDE9FE, #FDE68A)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem" }}>
        <div style={{ fontSize: 13, color: "#6D5EF7", marginBottom: 8 }}>Net Worth (Arc Mainnet)</div>
        <div className="flowfi-mono" style={{ fontSize: 32, fontWeight: 800, color: "#111827" }}>
          {loading && !balances.usdc ? "..." : `$${usdcVal.toFixed(2)}`}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "1rem", alignItems: "start" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Your Assets</div>
            <button onClick={() => onNavigate("mainnetbridge")} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
              Bridge more <ArrowUpRight size={13} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <TokenIcon symbol="USDC" size={34} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>USDC</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>USD Coin — Arc Mainnet</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{balances.usdc ?? "..."}</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>${usdcVal.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Sparkles size={16} color="#6D5EF7" />
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>AI Advisor</div>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#6D5EF7", background: "#ffffff", padding: "2px 7px", borderRadius: 999 }}>BETA</span>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") askAdvisor(); }}
              placeholder='Try "analyze BTC"'
              disabled={analyzing}
              style={{ flex: 1, background: "#ffffff", border: "none", borderRadius: 10, padding: "0.55rem 0.7rem", fontSize: 12.5, color: "#111827", outline: "none" }}
            />
            <button onClick={askAdvisor} disabled={analyzing || !query.trim()}
              style={{ padding: "0.55rem 0.8rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: analyzing || !query.trim() ? "not-allowed" : "pointer", opacity: analyzing || !query.trim() ? 0.6 : 1 }}>
              Ask
            </button>
          </div>

          <div style={{ background: "#ffffff", borderRadius: 16, padding: "1rem", minHeight: 84 }}>
            {analyzing && <div style={{ fontSize: 12, color: "#6B7280", textAlign: "center" }}>Analyzing...</div>}
            {!analyzing && analysisError && <div style={{ fontSize: 12, color: "#DC2626" }}>{analysisError}</div>}
            {!analyzing && !analysisError && analysis && renderAnalysis(analysis)}
            {!analyzing && !analysisError && !analysis && (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                  <Sparkles size={18} color="#6D5EF7" />
                </div>
                <p style={{ fontSize: 12.5, color: "#4B5563", margin: 0 }}>Ask about a token's price, RSI, or unlock schedule — or use the FlowFi Copilot in the corner to bridge/swap.</p>
              </div>
            )}
          </div>
          <p style={{ fontSize: 10, color: "#6B7280", textAlign: "center", marginTop: 10 }}>AI suggestions are for reference only, not financial advice.</p>
        </div>
      </div>

      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Recent Activity</div>
        </div>
        {!loading && recentTxs.length === 0 && <div style={{ fontSize: 12, color: "#6B7280" }}>No recent activity yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {recentTxs.map((tx) => (
            <a key={tx.hash} href={`https://arc.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem", textDecoration: "none" }}>
              <span style={{ fontSize: 12.5, color: "#374151" }}>{tx.method}</span>
              <span style={{ fontSize: 11, color: "#6B7280" }}>{tx.age}</span>
            </a>
          ))}
        </div>
      </div>

      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <ShieldCheck size={18} color="#6D5EF7" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Self-custody, always</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Every mainnet transaction is signed by your own wallet — FlowFi never holds your keys or your funds.</div>
        </div>
      </div>
    </div>
  );
}

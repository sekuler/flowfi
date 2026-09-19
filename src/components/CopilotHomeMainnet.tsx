import { useState, useEffect } from "react";
import { TokenIcon } from "./TokenIcon";
import { useIsMobile } from "../useIsMobile";
import { Sparkles, ArrowUpRight, ShieldCheck } from "lucide-react";

// Mainnet counterpart to CopilotHome.tsx (which stays as-is, Arc Testnet
// only). Deliberately narrower scope, per explicit decisions:
//   - "Total Value Locked" / "Active Pools" cards are gone entirely, not
//     replaced -- they read FlowFi's own testnet pool contracts, and
//     there is no mainnet equivalent (Pools was never ported, see
//     SECURITY.md's "Mainnet trust model").
//   - "AI Advisor" is a simple static card, not the dynamic
//     memory-insight version testnet's Home has -- points at the
//     floating Mainnet Copilot (bottom-right) instead of duplicating a
//     wallet-Q&A box here.
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

export default function CopilotHomeMainnet({ address, balances, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);

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
            <p style={{ fontSize: 13, color: "#4B5563" }}>Use the FlowFi Copilot in the corner to bridge or swap in plain language — it takes you to the right page to confirm with your own wallet.</p>
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

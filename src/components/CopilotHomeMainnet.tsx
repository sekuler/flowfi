import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { TokenIcon } from "./TokenIcon";
import NetworkGuard from "./NetworkGuard";
import { useIsMobile } from "../useIsMobile";
import { getFormattedMarketAnalysis } from "../marketData";
import { ArrowUpRight, ShieldCheck, Zap, Repeat, Wallet, Plus, Box, Send, CheckCircle2 } from "lucide-react";

// Mainnet counterpart to CopilotHome.tsx (which stays as-is, Arc Testnet
// only). Visual pass 2026-09-19 to close the "unfinished/empty shop" gap
// against a reference mockup: richer Net Worth card (inline actions,
// asset count, a purely decorative sparkline -- NOT a real historical
// chart, since FlowFi doesn't track net-worth history yet; a fabricated
// "+X% (24h)" figure would be a real, honest-ness problem for a finance
// app, so that's deliberately left out rather than faked), AI Advisor as
// clickable suggestion rows instead of a static paragraph, and richer
// Recent Activity rows (icon + truncated hash).
//   - "Total Value Locked" / "Active Pools" cards are gone entirely, not
//     replaced -- they read FlowFi's own testnet pool contracts, and
//     there is no mainnet equivalent (Pools was never ported, see
//     SECURITY.md's "Mainnet trust model").
//   - "Ask Your Wallet" does real token/market analysis (RSI, EMA, MACD,
//     etc.) via the same getFormattedMarketAnalysis() testnet's AiNarrator
//     uses -- chain-agnostic, so it's fine here -- and falls back to a
//     general question answered from Arc MAINNET's own recent activity
//     (via arcscan-proxy's `network=mainnet` routing), mirroring
//     AiNarrator's own two-step logic but scoped to mainnet data.
const METHOD_META: Record<string, { label: string; Icon: typeof Box }> = {
  "0xa9059cbb": { label: "Send", Icon: Send },
  "0x095ea7b3": { label: "Approve", Icon: CheckCircle2 },
};
function metaForMethodId(methodId: string | undefined): { label: string; Icon: typeof Box } {
  if (!methodId || methodId === "0x") return { label: "Contract Deploy", Icon: Box };
  return METHOD_META[methodId] ?? { label: "Activity", Icon: Box };
}

interface Props {
  address: string;
  balances: { usdc: string | null; native: string | null };
  onNavigate: (tab: "mainnetbridge" | "mainnetswap") => void;
  provider?: EIP1193Provider;
}

interface RecentTx {
  hash: string;
  label: string;
  Icon: typeof Box;
  age: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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

function isAnalysisMessage(text: string): boolean {
  const firstLine = text.split("\n")[0] ?? "";
  return /TIMEFRAME|PRICE STABILITY/.test(text) && !firstLine.startsWith("Elimdeki");
}

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

const SUGGESTED_QUESTIONS = [
  "How much USDC do I have?",
  "Find my last transaction",
  "How much have I sent in total?",
];

export default function CopilotHomeMainnet({ address, balances, onNavigate, provider }: Props) {
  const isMobile = useIsMobile();
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || asking) return;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setAsking(true);
    try {
      const marketAnswer = await getFormattedMarketAnalysis(question);
      if (marketAnswer) {
        setMessages((prev) => [...prev, { role: "assistant", content: marketAnswer }]);
        return;
      }
      const res = await fetch(`/api/arcscan-proxy?network=mainnet&module=account&action=txlist&address=${address}&limit=30`);
      const data = await res.json();
      const txs = (data.result ?? []).slice(0, 30).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId,
        timestamp: tx.timeStamp,
        value: tx.value,
      }));
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          system: `You are FlowFi's wallet assistant for Arc MAINNET (real funds). You are given the user's current USDC balance (${balances.usdc}) and their recent raw transaction list (method IDs, timestamps, values) from Arc Mainnet. Answer the user's question in plain, concise language, grounded ONLY in the data given. If the data doesn't contain enough information to answer precisely, say so honestly rather than guessing. Never give financial advice. Always respond in the same language the user's question is written in. Keep answers under 4 sentences.`,
          messages: [{ role: "user", content: `Transaction data: ${JSON.stringify(txs)}\n\nQuestion: ${question}` }],
        }),
      });
      const dataRes = await response.json();
      const answer = dataRes.content?.[0]?.text ?? "Could not generate a response.";
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/arcscan-proxy?network=mainnet&module=account&action=txlist&address=${address}&limit=4`);
        const data = await res.json();
        const items: RecentTx[] = (data.result ?? []).slice(0, 4).map((tx: any) => {
          const meta = metaForMethodId(tx.methodId);
          return { hash: tx.hash, label: meta.label, Icon: meta.Icon, age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—" };
        });
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
  const assetCount = usdcVal > 0 ? 1 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <NetworkGuard provider={provider} />
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EDE9FE", color: "#6D5EF7", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, alignSelf: "flex-start" }}>
        ⚡ MAINNET — real funds, self-custody
      </div>

      <div style={{ background: "linear-gradient(135deg, #EDE9FE, #FDE68A)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.75rem", display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 16 : 24, alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "#6D5EF7", marginBottom: 8, fontWeight: 600 }}>Net Worth (Arc Mainnet)</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <div className="flowfi-mono" style={{ fontSize: 40, fontWeight: 800, color: "#111827", lineHeight: 1 }}>
              {loading && !balances.usdc ? "..." : `$${usdcVal.toFixed(2)}`}
            </div>
            {!isMobile && (
              // Purely decorative texture, not a real historical chart —
              // FlowFi doesn't track net-worth history yet, so this
              // deliberately carries no numbers or axis that could be
              // mistaken for real data.
              <svg width="120" height="36" viewBox="0 0 120 36" style={{ opacity: 0.5, marginBottom: 4 }}>
                <path d="M0 24 Q 15 10, 30 20 T 60 16 T 90 22 T 120 12" stroke="#6D5EF7" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "#7C6FA8", marginTop: 8 }}>{assetCount} asset{assetCount === 1 ? "" : "s"} · Arc Mainnet</div>
        </div>
        <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: 8 }}>
          {[
            { label: "Bridge", Icon: Zap, target: "mainnetbridge" as const },
            { label: "Swap", Icon: Repeat, target: "mainnetswap" as const },
            { label: "Add funds", Icon: Wallet, target: "mainnetbridge" as const },
          ].map((a) => (
            <button key={a.label} onClick={() => onNavigate(a.target)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "0.6rem 1rem", borderRadius: 12, border: "none", background: "#ffffff", color: "#111827", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              <a.Icon size={14} color="#6D5EF7" /> {a.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1.3fr)", gap: "1rem", alignItems: "start" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Your Assets</div>
            <button onClick={() => onNavigate("mainnetbridge")} style={{ background: "rgba(109,94,247,0.1)", border: "none", borderRadius: 999, padding: "4px 10px", color: "#6D5EF7", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
              Bridge more <ArrowUpRight size={12} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.25rem", borderBottom: "1px solid #F5F3FF" }}>
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
          <button onClick={() => onNavigate("mainnetbridge")}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "0.65rem 0.25rem", border: "none", background: "none", color: "#9CA3AF", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
            <Plus size={14} /> Add token
          </button>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff" }}>✦</div>
            <span style={{ fontSize: 12.5, color: "#111827", fontWeight: 700 }}>Ask your wallet</span>
          </div>

          {messages.length === 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} onClick={() => ask(q)} disabled={asking}
                  style={{ padding: "6px 12px", borderRadius: 999, border: "none", background: "#F5F3FF", color: "#6D5EF7", fontSize: 11, cursor: "pointer" }}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
              {messages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: m.role === "user" ? "92%" : "100%",
                  background: m.role === "user" ? "#6D5EF7" : "#F5F3FF",
                  borderRadius: 12, padding: "0.55rem 0.75rem",
                  color: m.role === "user" ? "#ffffff" : "#374151",
                  whiteSpace: "pre-wrap", overflowWrap: "break-word",
                }}>
                  {m.role === "assistant" && isAnalysisMessage(m.content) ? renderAnalysis(m.content) : <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{m.content}</span>}
                </div>
              ))}
              {asking && <div style={{ fontSize: 11, color: "#6B7280" }}>Thinking...</div>}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
            <input type="text" placeholder="Ask about your wallet activity..." value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
              disabled={asking}
              style={{ flex: 1, background: "#F5F3FF", border: "none", borderRadius: 10, padding: "0.55rem 0.75rem", fontSize: 12, color: "#111827", outline: "none" }} />
            <button onClick={() => ask(input)} disabled={asking || !input.trim()}
              style={{ padding: "0.55rem 0.9rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: asking || !input.trim() ? "not-allowed" : "pointer", opacity: asking || !input.trim() ? 0.6 : 1 }}>
              Ask
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Recent Activity</div>
          <a href={`https://arc.etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: "#6D5EF7", fontWeight: 600, textDecoration: "none" }}>View all</a>
        </div>
        {!loading && recentTxs.length === 0 && <div style={{ fontSize: 12, color: "#6B7280" }}>No recent activity yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {recentTxs.map((tx) => (
            <a key={tx.hash} href={`https://arc.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.25rem", textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <tx.Icon size={14} color="#6D5EF7" />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: "#111827", fontWeight: 600 }}>{tx.label}</div>
                  <div className="flowfi-mono" style={{ fontSize: 10.5, color: "#9CA3AF" }}>{tx.hash.slice(0, 6)}...{tx.hash.slice(-4)}</div>
                </div>
              </div>
              <span style={{ fontSize: 11, color: "#6B7280" }}>{tx.age}</span>
            </a>
          ))}
        </div>
        {!loading && (
          <div style={{ textAlign: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid #F5F3FF", fontSize: 11.5, color: "#9CA3AF" }}>
            No more activity ·{" "}
            <button onClick={() => onNavigate("mainnetbridge")} style={{ background: "none", border: "none", color: "#6D5EF7", fontWeight: 700, cursor: "pointer", fontSize: 11.5, padding: 0 }}>Bridge funds →</button>
          </div>
        )}
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

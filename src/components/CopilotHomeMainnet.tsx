import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { TokenIcon } from "./TokenIcon";
import NetworkGuard from "./NetworkGuard";
import { useIsMobile } from "../useIsMobile";
import { getFormattedMarketAnalysis } from "../marketData";
import { ArrowRight, ShieldCheck, Zap, Repeat, Plus, PlusCircle, Send, CheckCircle2, XCircle, Clock, Sparkles } from "lucide-react";
import Sparkline from "./Sparkline";
import { usePortfolio, money, type MainnetBalances } from "./usePortfolio";
import { loadLifiDiamond, describeTx, counterpartOf, toTx, type Tx } from "./txUtils";

// Mainnet counterpart to CopilotHome.tsx (which stays as-is, Arc Testnet
// only). Layout follows the FlowFi reference mockup: net-worth hero, an
// even Bridge / Swap / Add funds action row, Your Assets next to
// "Ask your wallet", then Recent activity.
//   - The net-worth chart is drawn from daily snapshots this browser
//     records (see usePortfolio.ts), never from made-up data: with fewer
//     than two days recorded it says so instead of drawing a curve.
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
//   - Recent activity is labelled with the same logic as the History and
//     Dashboard pages (txUtils.tsx).

interface Props {
  address: string;
  balances: MainnetBalances;
  onNavigate: (tab: "mainnetbridge" | "mainnetswap" | "mainnethistory") => void;
  provider?: EIP1193Provider;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [diamond, setDiamond] = useState<string | null>(null);

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
    let cancelled = false;
    loadLifiDiamond().then((d) => { if (!cancelled) setDiamond(d); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/arcscan-proxy?network=mainnet&module=account&action=txlist&address=${address}&limit=4`);
        const data = await res.json();
        setTxs((data.result ?? []).slice(0, 4).map(toTx));
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    }
    if (address) load();
  }, [address]);

  const { total, distribution, chartPoints, hasChart } = usePortfolio(address, balances);
  const assetCount = distribution.length;
  const assetNames = distribution.map((d) => d.label).join(", ");

  const card = { background: "#ffffff", border: "1px solid #E4DDFB", borderRadius: 20, boxShadow: "0 8px 30px -14px rgba(109,94,247,0.2)" } as const;
  const statusIcon = (s: string) =>
    s === "ok" ? <CheckCircle2 size={20} color="#16A34A" /> : s === "error" ? <XCircle size={20} color="#DC2626" /> : <Clock size={20} color="#B45309" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <NetworkGuard provider={provider} />
      <style>{`
        .ff-ask:focus { border-color: #6D5EF7 !important; box-shadow: 0 0 0 3px rgba(109,94,247,0.15) !important; outline: none; }
        .ff-action { transition: all 0.15s; }
        .ff-action:hover { border-color: #C9BDFB; background: #FBFAFF; transform: translateY(-1px); }
        .ff-row:hover { background: rgba(109,94,247,0.05); }
      `}</style>

      <div style={{ ...card, background: "linear-gradient(135deg, #FFFFFF 0%, #F6F3FF 100%)", padding: isMobile ? "1.25rem" : "1.6rem 1.8rem", display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 18 : 28, alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", overflow: "hidden" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "#6B7280", fontWeight: 600, marginBottom: 6 }}>Net worth</div>
          <div className="flowfi-mono" style={{ fontSize: isMobile ? 40 : 52, fontWeight: 700, color: "#111827", lineHeight: 1.05, letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" }}>
            {balances.usdc === null && loading ? "…" : `$${money(total)}`}
          </div>
          <div style={{ fontSize: 14, color: "#6B7280", marginTop: 8 }}>
            {assetCount} asset{assetCount === 1 ? "" : "s"}{assetCount > 0 ? ` · ${assetNames}` : ""}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, padding: "5px 12px", borderRadius: 999, background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", fontSize: 11, fontWeight: 700, letterSpacing: "0.6px" }}>
            <ShieldCheck size={13} /> REAL FUNDS · SELF-CUSTODY
          </div>
        </div>
        <div style={{ flex: 1, maxWidth: isMobile ? "none" : 460, minWidth: isMobile ? 0 : 220 }}>
          {hasChart ? (
            <>
              <Sparkline points={chartPoints} height={96} />
              <div style={{ fontSize: 10.5, color: "#9CA3AF", textAlign: "right", marginTop: 4 }}>{chartPoints.length} days</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: isMobile ? "left" : "right" }}>Chart builds as you visit. Not enough history yet.</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
        {[
          { label: "Bridge", Icon: Zap, target: "mainnetbridge" as const },
          { label: "Swap", Icon: Repeat, target: "mainnetswap" as const },
          { label: "Add funds", Icon: PlusCircle, target: "mainnetbridge" as const },
        ].map((a) => (
          <button key={a.label} onClick={() => onNavigate(a.target)} className="ff-action"
            style={{ ...card, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: isMobile ? "0.9rem 0.5rem" : "1.05rem 1rem", color: "#111827", fontSize: isMobile ? 13 : 15, fontWeight: 600, cursor: "pointer" }}>
            <a.Icon size={isMobile ? 18 : 20} color="#6D5EF7" /> {a.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "1rem", alignItems: "stretch" }}>
        <div style={{ ...card, padding: "1.25rem", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Your Assets</div>
            <button onClick={() => onNavigate("mainnetbridge")} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> Add token
            </button>
          </div>
          <div style={{ border: "1px solid #F1EEFF", borderRadius: 14, overflow: "hidden" }}>
            {distribution.length === 0 && <div style={{ padding: "1rem", fontSize: 12.5, color: "#9CA3AF" }}>{balances.usdc === null ? "Loading..." : "No assets yet."}</div>}
            {distribution.map((d, i) => (
              <div key={d.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1rem", borderTop: i > 0 ? "1px solid #F5F3FF" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <TokenIcon symbol={d.label} size={38} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{d.label} <span style={{ color: "#9CA3AF", fontWeight: 500 }}>· Arc</span></div>
                    <div className="flowfi-mono" style={{ fontSize: 12, color: "#6B7280", fontVariantNumeric: "tabular-nums" }}>{d.amount} {d.label}</div>
                  </div>
                </div>
                <div className="flowfi-mono" style={{ fontSize: 16, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums" }}>${money(d.value)}</div>
              </div>
            ))}
          </div>
          <button onClick={() => onNavigate("mainnetbridge")}
            style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto", paddingTop: 14, background: "none", border: "none", color: "#4B5563", fontSize: 13, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start" }}>
            Bridge more <ArrowRight size={14} />
          </button>
        </div>

        <div style={{ ...card, padding: "1.25rem", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={18} color="#6D5EF7" />
              <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Ask your wallet</span>
            </div>
            <div style={{ fontSize: 12.5, color: "#6B7280", marginTop: 3 }}>Copilot for your Arc wallet</div>
          </div>

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

          <div style={{ display: "flex", gap: 8, alignItems: "center", border: "1.5px solid #D9D0FA", borderRadius: 14, padding: "0.35rem 0.4rem 0.35rem 0.9rem", background: "#FBFAFF" }} className="ff-ask-wrap">
            <input className="ff-ask" type="text" placeholder="Ask anything about your wallet..." value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
              disabled={asking}
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", boxShadow: "none", fontSize: 13.5, color: "#111827", outline: "none", padding: "0.5rem 0" }} />
            <button onClick={() => ask(input)} disabled={asking || !input.trim()} aria-label="Ask"
              style={{ width: 38, height: 38, borderRadius: 11, border: "none", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: asking || !input.trim() ? "not-allowed" : "pointer", opacity: asking || !input.trim() ? 0.55 : 1, flexShrink: 0 }}>
              <Send size={16} />
            </button>
          </div>

          {messages.length === 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} onClick={() => ask(q)} disabled={asking}
                  style={{ padding: "7px 13px", borderRadius: 999, border: "1px solid #DDD6FA", background: "#ffffff", color: "#4B5563", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ ...card, padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Recent activity</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.18)" }} />
          </div>
          <button onClick={() => onNavigate("mainnethistory")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#6D5EF7", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        {loading && <div style={{ fontSize: 12.5, color: "#6B7280", padding: "0.5rem 0" }}>Loading...</div>}
        {!loading && txs.length === 0 && <div style={{ fontSize: 12.5, color: "#6B7280", padding: "0.5rem 0" }}>No recent activity yet.</div>}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {txs.map((tx, i) => (
            <a key={tx.hash} href={`https://arc.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="ff-row"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "0.75rem 0.4rem", textDecoration: "none", borderTop: i > 0 ? "1px solid #F5F3FF" : "none", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                {statusIcon(tx.status)}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#111827", fontWeight: 600 }}>{describeTx(tx, address, "mainnet", diamond)}</div>
                  <div className="flowfi-mono" style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{counterpartOf(tx, address)} · Arc Mainnet</div>
                </div>
              </div>
              <span style={{ fontSize: 12, color: "#6B7280", flexShrink: 0 }}>{tx.age}</span>
            </a>
          ))}
        </div>
      </div>

      <div style={{ ...card, borderRadius: 16, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: 10 }}>
        <ShieldCheck size={18} color="#6D5EF7" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Self-custody, always</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Every mainnet transaction is signed by your own wallet — FlowFi never holds your keys or your funds.</div>
        </div>
      </div>
    </div>
  );
}

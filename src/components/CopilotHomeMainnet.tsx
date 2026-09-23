import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { TokenIcon } from "./TokenIcon";
import NetworkGuard from "./NetworkGuard";
import { useIsMobile } from "../useIsMobile";
import { getFormattedMarketAnalysis } from "../marketData";
import { ArrowRight, ShieldCheck, Zap, Repeat, Plus, Send, CheckCircle2, XCircle, Clock, Sparkles, Check } from "lucide-react";
import Sparkline from "./Sparkline";
import { usePortfolio, money, type MainnetBalances } from "./usePortfolio";
import { USDC_LOGO, EURC_LOGO } from "./tokenLogos";
import { loadLifiDiamond, describeTx, counterpartOf, fetchActivity, type Tx } from "./txUtils";

// Mainnet counterpart to CopilotHome.tsx (which stays as-is, Arc Testnet
// only). Two states:
//   - First visit / empty wallet: dark welcome hero with Add funds + Bridge,
//     a 3-step "Get started" checklist, and the Copilot with new-user
//     questions. Recent activity is hidden while there is none.
//   - Funded wallet: dark balance hero (net worth + sparkline + actions),
//     owned assets only (zero balances hidden), Copilot, Recent activity.
// The net-worth chart is drawn from daily snapshots this browser records
// (see usePortfolio.ts), never from made-up data.
// "Ask your wallet" does real token/market analysis via
// getFormattedMarketAnalysis() and falls back to a question answered from
// Arc MAINNET's own recent activity (arcscan-proxy `network=mainnet`).

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

// Design tokens (home only)
const INK = "#16151C";
const ACCENT = "#3D5AF1";
const ACCENT_SOFT = "#EEF1FE";
const LINE = "#E7E4DD";
const MUTED = "#5E5B6B";
const SOFT_BG = "#FBFAF8";

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
        if (i === 0) return <div key={i} style={{ fontSize: 14, fontWeight: 700, color: INK }}>{line}</div>;
        if (i === 1 && line.startsWith("$")) return <div key={i} className="ffh-mono" style={{ fontSize: 16, fontWeight: 600, color: ACCENT, marginBottom: 4 }}>{line}</div>;
        if (ANALYSIS_SECTION_HEADERS.has(trimmed)) return <div key={i} style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5 }}>{trimmed}</div>;
        if (trimmed.startsWith("⚠️")) return <div key={i} style={{ marginTop: 6, fontSize: 10, color: "#6B6876" }}>{line}</div>;
        if (!trimmed) return <div key={i} style={{ height: 2 }} />;
        return <div key={i} style={{ fontSize: 12.5, color: "#3F3D48", lineHeight: 1.5 }}>{line}</div>;
      })}
    </div>
  );
}

const QUESTIONS_NEW = [
  "How do I get USDC on Arc?",
  "What can I do with FlowFi?",
  "How does bridging work?",
];

const QUESTIONS_FUNDED = [
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
      const res = await fetch(`/api/arcscan-proxy?network=mainnet&module=account&action=txlist&address=${address}&sort=desc&limit=30`);
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
          system: `You are FlowFi's wallet assistant for Arc MAINNET (real funds). You are given the user's current USDC balance (${balances.usdc}) and their recent raw transaction list (method IDs, timestamps, values) from Arc Mainnet. For questions about the user's wallet, answer grounded ONLY in the data given; if the data doesn't contain enough information, say so honestly rather than guessing. For questions about how to use FlowFi, explain briefly: USDC can be brought onto Arc from other chains on FlowFi's Bridge page (routed via LI.FI or Circle's native CCTP), tokens on Arc can be swapped on the Swap page, and every transaction is signed by the user's own wallet — FlowFi never holds keys or funds. Never give financial advice. Always respond in the same language the user's question is written in. Keep answers under 4 sentences.`,
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
        setTxs((await fetchActivity(address, "mainnet", 10)).slice(0, 4));
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    }
    if (address) load();
  }, [address]);

  const { total, holdings, chartPoints, hasChart } = usePortfolio(address, balances);
  const owned = holdings.filter((d) => d.n > 0);
  const balancesLoading = balances.usdc === null;
  const isNew = !balancesLoading && owned.length === 0;

  const card = { background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 20 } as const;
  const statusIcon = (s: string) =>
    s === "ok" ? <CheckCircle2 size={20} color="#0E9F6E" /> : s === "error" ? <XCircle size={20} color="#DC2626" /> : <Clock size={20} color="#B45309" />;

  const steps = [
    { title: "Add USDC to your wallet", sub: "Bridge USDC onto Arc from Ethereum, Base, Arbitrum and more.", done: owned.length > 0, action: () => onNavigate("mainnetbridge") },
    { title: "Make your first swap", sub: "Trade USDC for EURC, cirBTC or other tokens on Arc.", done: !loading && txs.length > 0, action: () => onNavigate("mainnetswap") },
    { title: "Ask the Copilot", sub: "Get plain-language answers about your wallet and the market.", done: messages.length > 0, action: () => document.getElementById("ffh-ask")?.focus() },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const currentStep = steps.findIndex((s) => !s.done);

  const primaryBtn = { display: "flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px", border: "none", borderRadius: 12, background: ACCENT, color: "#FFFFFF", fontSize: 15, fontWeight: 600, cursor: "pointer" } as const;
  const ghostBtn = { display: "flex", alignItems: "center", gap: 8, height: 48, padding: "0 20px", borderRadius: 12, background: "transparent", border: "1px solid #45424F", color: "#FFFFFF", fontSize: 15, fontWeight: 500, cursor: "pointer" } as const;

  const hero = (
    <section style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.6fr) minmax(0, 1fr)", gap: isMobile ? 24 : 40, padding: isMobile ? "1.75rem 1.4rem" : "2.5rem 2.75rem", borderRadius: 24, background: INK, color: "#FFFFFF" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#B9B6C6" }}>
          <ShieldCheck size={15} /> Self-custody · you sign every transaction
        </div>
        {isNew ? (
          <>
            <h2 className="ffh-display" style={{ margin: 0, fontSize: isMobile ? 32 : 44, lineHeight: 1.05, fontWeight: 600, letterSpacing: "-0.025em" }}>
              Welcome to FlowFi.<br />Let's put your wallet to work.
            </h2>
            <p style={{ margin: 0, maxWidth: 520, fontSize: 16, lineHeight: 1.55, color: "#CFCCDA" }}>
              Bring USDC onto Arc to start swapping and bridging — with an AI copilot that explains every step.
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, color: "#A8A5B5" }}>Net worth</div>
            <div className="ffh-mono" style={{ fontSize: isMobile ? 40 : 56, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {balancesLoading ? "…" : `$${money(total)}`}
            </div>
            <div style={{ fontSize: 14, color: "#A8A5B5" }}>
              {balancesLoading ? "Loading balances…" : `${owned.length} asset${owned.length === 1 ? "" : "s"} · ${owned.map((d) => d.label).join(", ")}`}
            </div>
          </>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
          <button onClick={() => onNavigate("mainnetbridge")} style={primaryBtn}>
            <Plus size={18} /> Add funds
          </button>
          {isNew ? (
            <button onClick={() => onNavigate("mainnetbridge")} style={ghostBtn}>Bridge from another chain</button>
          ) : (
            <>
              <button onClick={() => onNavigate("mainnetswap")} style={ghostBtn}><Repeat size={16} /> Swap</button>
              <button onClick={() => onNavigate("mainnetbridge")} style={ghostBtn}><Zap size={16} /> Bridge</button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 20, padding: 24, borderRadius: 18, background: "#211F29", border: "1px solid #2E2C37", minWidth: 0 }}>
        {isNew ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#A8A5B5" }}>Total balance</span>
            <span className="ffh-mono" style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em" }}>$0.00</span>
          </div>
        ) : hasChart ? (
          <div>
            <Sparkline points={chartPoints} height={96} />
            <div style={{ fontSize: 11, color: "#A8A5B5", textAlign: "right", marginTop: 6 }}>{chartPoints.length} days</div>
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#A8A5B5" }}>Your balance chart appears after a couple of days of visits.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ height: 1, background: "#2E2C37" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#A8A5B5" }}>
            <span>Assets</span><span style={{ color: "#FFFFFF" }}>{isNew ? "None yet" : balancesLoading ? "…" : owned.length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#A8A5B5" }}>
            <span>Network</span><span style={{ color: "#FFFFFF" }}>Arc Mainnet</span>
          </div>
        </div>
      </div>
    </section>
  );

  const checklist = (
    <section style={{ ...card, padding: isMobile ? "1.25rem" : 28, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h3 className="ffh-display" style={{ margin: 0, fontSize: 20, fontWeight: 600, color: INK }}>Get started in 3 steps</h3>
        <span style={{ fontSize: 13, color: MUTED }}>{doneCount} of 3 done</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#EFEDE8" }}>
        <div style={{ width: `${Math.max(4, (doneCount / 3) * 100)}%`, height: 6, borderRadius: 3, background: ACCENT, transition: "width 0.3s ease" }} />
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((s, i) => {
          const current = i === currentStep;
          return (
            <li key={s.title}>
              <button onClick={s.action} className="ffh-step"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "14px 16px", borderRadius: 14, border: "none", background: current ? ACCENT_SOFT : "transparent", textAlign: "left", cursor: "pointer" }}>
                <span style={{
                  width: 32, height: 32, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, boxSizing: "border-box",
                  background: s.done ? "#0E9F6E" : current ? ACCENT : "transparent",
                  border: s.done || current ? "none" : "1.5px solid #D6D3CC",
                  color: s.done || current ? "#FFFFFF" : "#6B6876",
                }}>
                  {s.done ? <Check size={16} /> : i + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: s.done ? MUTED : INK, textDecoration: s.done ? "line-through" : "none" }}>{s.title}</span>
                  <span style={{ fontSize: 13, color: MUTED }}>{s.sub}</span>
                </span>
                {current && <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 600, color: ACCENT, flexShrink: 0 }}>Start <ArrowRight size={14} /></span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );

  const assets = (
    <section style={{ ...card, padding: isMobile ? "1.25rem" : 28, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 className="ffh-display" style={{ margin: 0, fontSize: 20, fontWeight: 600, color: INK }}>Your assets</h3>
        <button onClick={() => onNavigate("mainnetbridge")} style={{ background: "none", border: "none", color: ACCENT, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={14} /> Add
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {balancesLoading && <div style={{ padding: "0.75rem 0", fontSize: 13, color: MUTED }}>Loading…</div>}
        {owned.map((d, i) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.9rem 0", borderTop: i > 0 ? `1px solid ${LINE}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {d.label === "USDC" || d.label === "EURC"
                ? <img src={d.label === "USDC" ? USDC_LOGO : EURC_LOGO} alt="" width={38} height={38} style={{ width: 38, height: 38, borderRadius: "50%" }} />
                : <TokenIcon symbol={d.label} size={38} />}
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{d.label}</div>
                <div className="ffh-mono" style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{d.amount} {d.label}</div>
              </div>
            </div>
            <div className="ffh-mono" style={{ fontSize: 16, fontWeight: 500, color: INK, fontVariantNumeric: "tabular-nums" }}>{d.value !== null ? `$${money(d.value)}` : "—"}</div>
          </div>
        ))}
      </div>
    </section>
  );

  const suggestions = isNew ? QUESTIONS_NEW : QUESTIONS_FUNDED;

  const copilot = (
    <section style={{ ...card, padding: isMobile ? "1.25rem" : 28, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT_SOFT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Sparkles size={18} color={ACCENT} />
        </span>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <label htmlFor="ffh-ask" className="ffh-display" style={{ fontSize: 18, fontWeight: 600, color: INK }}>FlowFi Copilot</label>
          <span style={{ fontSize: 13, color: MUTED }}>{isNew ? "New to DeFi? Just ask." : "Ask anything about your wallet."}</span>
        </div>
      </div>

      {messages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: m.role === "user" ? "92%" : "100%",
              background: m.role === "user" ? INK : SOFT_BG,
              border: m.role === "user" ? "none" : `1px solid ${LINE}`,
              borderRadius: 12, padding: "0.6rem 0.8rem",
              color: m.role === "user" ? "#FFFFFF" : "#3F3D48",
              whiteSpace: "pre-wrap", overflowWrap: "break-word",
            }}>
              {m.role === "assistant" && isAnalysisMessage(m.content) ? renderAnalysis(m.content) : <span style={{ fontSize: 13, lineHeight: 1.5 }}>{m.content}</span>}
            </div>
          ))}
          {asking && <div style={{ fontSize: 12, color: MUTED }}>Thinking…</div>}
        </div>
      )}

      {messages.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggestions.map((q) => (
            <button key={q} onClick={() => ask(q)} disabled={asking} className="ffh-suggest"
              style={{ textAlign: "left", minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${LINE}`, background: SOFT_BG, fontSize: 14, color: INK, cursor: "pointer" }}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="ffh-ask-wrap" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", padding: "6px 6px 6px 14px", borderRadius: 14, border: "1px solid #D6D3CC", background: "#FFFFFF" }}>
        <input id="ffh-ask" type="text" placeholder="Ask anything…" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
          disabled={asking}
          style={{ flex: 1, minWidth: 0, height: 36, border: "none", outline: "none", boxShadow: "none", fontSize: 14, background: "transparent", color: INK }} />
        <button onClick={() => ask(input)} disabled={asking || !input.trim()} aria-label="Send"
          style={{ width: 40, height: 40, border: "none", borderRadius: 10, background: INK, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: asking || !input.trim() ? "not-allowed" : "pointer", opacity: asking || !input.trim() ? 0.5 : 1 }}>
          <Send size={16} />
        </button>
      </div>
    </section>
  );

  const activity = (
    <section style={{ ...card, padding: isMobile ? "1.25rem" : 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 className="ffh-display" style={{ margin: 0, fontSize: 20, fontWeight: 600, color: INK }}>Recent activity</h3>
        <button onClick={() => onNavigate("mainnethistory")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: ACCENT, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          View all <ArrowRight size={14} />
        </button>
      </div>
      {loading && <div style={{ fontSize: 13, color: MUTED, padding: "0.5rem 0" }}>Loading…</div>}
      {!loading && txs.length === 0 && <div style={{ fontSize: 13, color: MUTED, padding: "0.5rem 0" }}>No transactions yet.</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {txs.map((tx, i) => (
          <a key={tx.hash} href={`https://arc.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="ffh-row"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "0.8rem 0.5rem", textDecoration: "none", borderTop: i > 0 ? `1px solid ${LINE}` : "none", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              {statusIcon(tx.status)}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: INK, fontWeight: 600 }}>{describeTx(tx, address, "mainnet", diamond, true)}</div>
                <div className="ffh-mono" style={{ fontSize: 12, color: MUTED, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{counterpartOf(tx, address)}</div>
              </div>
            </div>
            <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{tx.age}</span>
          </a>
        ))}
      </div>
    </section>
  );

  const twoCol = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "1.5rem", alignItems: "stretch" } as const;

  return (
    <div className="ffh" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <NetworkGuard provider={provider} />
      <style>{`
        .ffh, .ffh * { font-family: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .ffh .ffh-display { font-family: 'Bricolage Grotesque', 'Geist', system-ui, sans-serif; }
        .ffh .ffh-mono { font-family: 'Geist Mono', ui-monospace, monospace; }
        .ffh .ffh-step:hover { background: ${ACCENT_SOFT} !important; transform: none !important; }
        .ffh .ffh-suggest:hover { border-color: #C3CCF8 !important; background: #FFFFFF !important; }
        .ffh .ffh-row:hover { background: ${SOFT_BG}; }
        .ffh .ffh-ask-wrap:focus-within { border-color: ${ACCENT} !important; box-shadow: 0 0 0 3px rgba(61,90,241,0.14); }
        .ffh #ffh-ask:focus { box-shadow: none; }
      `}</style>

      {hero}

      {isNew ? (
        <div style={twoCol}>
          {checklist}
          {copilot}
        </div>
      ) : (
        <>
          <div style={twoCol}>
            {assets}
            {copilot}
          </div>
          {activity}
        </>
      )}
    </div>
  );
}

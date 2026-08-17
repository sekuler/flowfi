import { useState } from "react";
import { getFormattedMarketAnalysis } from "../marketData";

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_QUESTIONS = [
  "How much USDC do I have?",
  "Find my last bridge transaction",
  "Where did my USDC go this week?",
  "How much have I sent in total?",
];

// If the AI's answer mentions a full tx hash, turn it into a clickable
// Arcscan link instead of leaving it as inert text the user has to copy.
const ANALYSIS_SECTION_HEADERS = new Set([
  "TIMEFRAME", "KEY LEVELS", "MULTI-TIMEFRAME INSIGHT", "WHAT TO WATCH",
  "Tokenomics", "Token Vesting & Unlocks", "PRICE STABILITY", "STABILITY NOTE", "Supply",
]);

function isAnalysisMessage(text: string): boolean {
  const firstLine = text.split("\n")[0] ?? "";
  return /TIMEFRAME|PRICE STABILITY/.test(text) && !firstLine.startsWith("Elimdeki");
}

function renderAnalysisContent(content: string) {
  const lines = content.split("\n");
  const nodes: JSX.Element[] = [];
  let i = 0;

  if (lines[0]) {
    nodes.push(<div key="title" style={{ fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 2 }}>{lines[0]}</div>);
    i = 1;
  }
  if (lines[1] && lines[1].startsWith("$")) {
    nodes.push(<div key="price" style={{ fontSize: 20, fontWeight: 800, color: "#6D5EF7", fontFamily: "ui-monospace, monospace", marginBottom: 2 }}>{lines[1]}</div>);
    i = 2;
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (ANALYSIS_SECTION_HEADERS.has(trimmed)) {
      nodes.push(
        <div key={i} style={{ marginTop: 10, marginBottom: 2, paddingTop: 8, borderTop: "1px solid #E5E0FA", fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: "#6D5EF7", textTransform: "uppercase" }}>
          {trimmed}
        </div>
      );
    } else if (trimmed.startsWith("⚠️")) {
      nodes.push(<div key={i} style={{ marginTop: 10, fontSize: 11, color: "#9CA3AF", lineHeight: 1.4 }}>{line}</div>);
    } else if (trimmed.length > 0) {
      nodes.push(<div key={i} style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.55, overflowWrap: "break-word", wordBreak: "break-word" }}>{line}</div>);
    } else {
      nodes.push(<div key={i} style={{ height: 2 }} />);
    }
  }
  return <>{nodes}</>;
}

function renderWithTxLinks(text: string) {
  const hashPattern = /0x[a-fA-F0-9]{64}/g;
  const parts = text.split(hashPattern);
  const hashes = text.match(hashPattern) ?? [];
  const nodes: (string | JSX.Element)[] = [];
  parts.forEach((part, i) => {
    nodes.push(part);
    if (hashes[i]) {
      nodes.push(
        <a key={i} href={`https://testnet.arcscan.app/tx/${hashes[i]}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7", fontWeight: 600 }}>
          {hashes[i].slice(0, 10)}...{hashes[i].slice(-6)}
        </a>
      );
    }
  });
  return nodes;
}

export default function AiNarrator({ address, balances }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      // Try a market/coin analysis first. All numbers here come from our own
      // cached backend endpoint (api/market-analysis) — deterministic, real,
      // never touched by the AI. If no coin is detected, this returns null
      // and we fall through to the wallet-question flow below.
      const marketAnswer = await getFormattedMarketAnalysis(question);
      if (marketAnswer) {
        setMessages((prev) => [...prev, { role: "assistant", content: marketAnswer }]);
        setLoading(false);
        return;
      }

      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=30`);
      const data = await res.json();
      const txs = (data.result ?? []).slice(0, 30).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId,
        timestamp: tx.timeStamp,
        value: tx.value,
        status: tx.txreceipt_status,
      }));

        const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          system: `You are FlowFi's wallet assistant. You are given the user's current balances (USDC: ${balances.usdc}, EURC: ${balances.eurc}, USYC: ${balances.usyc}) and their recent raw transaction list (method IDs, timestamps, values) from Arc Testnet. Answer the user's question in plain, concise language, grounded ONLY in the data given. If the data doesn't contain enough information to answer precisely, say so honestly rather than guessing. Do not invent transaction details not present in the data. Always respond in the same language the user's question is written in. Keep answers under 4 sentences.`,
          messages: [
            { role: "user", content: `Transaction data: ${JSON.stringify(txs)}\n\nQuestion: ${question}` },
          ],
        }),
      });
      const dataRes = await response.json();
      const answer = dataRes.content?.[0]?.text ?? "Could not generate a response.";
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {expanded && (
        <div onClick={() => setExpanded(false)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.35)", zIndex: 998 }} />
      )}
      <div style={expanded
        ? { position: "fixed", top: 16, right: 16, bottom: 16, left: "auto", width: "min(560px, calc(100vw - 32px))", zIndex: 999, background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, boxShadow: "-16px 0 48px rgba(17,24,39,0.2)", padding: "1.4rem", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }
        : { background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: expanded ? 26 : 22, height: expanded ? 26 : 22, borderRadius: 7, background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: expanded ? 13 : 11, color: "#fff" }}>✦</div>
            <span style={{ fontSize: expanded ? 14 : 12, color: "#6D5EF7", fontWeight: 700, letterSpacing: "0.5px" }}>ASK YOUR WALLET</span>
          </div>
          <button onClick={() => setExpanded(!expanded)} title={expanded ? "Shrink" : "Expand"}
            style={{ background: "rgba(109,94,247,0.1)", border: "none", borderRadius: 8, color: "#6D5EF7", cursor: "pointer", fontSize: 13, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {expanded ? "⤡" : "⤢"}
          </button>
        </div>

        {messages.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} onClick={() => ask(q)} disabled={loading}
                style={{ padding: "6px 12px", borderRadius: 999, border: "none", background: "#ffffff", color: "#6D5EF7", fontSize: 11, cursor: "pointer" }}>
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: expanded ? 1 : undefined, maxHeight: expanded ? undefined : 480 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: m.role === "user" ? "92%" : "100%",
                background: m.role === "user" ? "#6D5EF7" : "#ffffff",
                borderRadius: 12,
                padding: expanded ? "0.9rem 1.1rem" : "0.6rem 0.8rem",
                color: m.role === "user" ? "#ffffff" : "#374151",
                whiteSpace: "pre-wrap",
                minWidth: 0,
                overflowWrap: "break-word",
              }}>
                {m.role === "assistant" ? (isAnalysisMessage(m.content) ? renderAnalysisContent(m.content) : <span style={{ fontSize: 13, lineHeight: 1.5 }}>{renderWithTxLinks(m.content)}</span>) : <span style={{ fontSize: expanded ? 15 : 13, lineHeight: 1.5 }}>{m.content}</span>}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", fontSize: 12, color: "#6B7280" }}>Reading your activity...</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="Ask about your wallet activity..." value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
            disabled={loading}
            style={{ flex: 1, background: expanded ? "#f5f3ff" : "#ffffff", border: "none", borderRadius: 12, padding: expanded ? "0.9rem 1.1rem" : "0.6rem 0.9rem", fontSize: expanded ? 15 : 13, color: "#111827", outline: "none" }} />
          <button onClick={() => ask(input)} disabled={loading || !input.trim()}
            style={{ padding: expanded ? "0.9rem 1.4rem" : "0.6rem 1rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: expanded ? 15 : 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}>
            Ask
          </button>
        </div>
      </div>
    </>
  );
}

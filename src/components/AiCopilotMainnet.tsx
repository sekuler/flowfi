import type { JSX } from 'react';
import { useState } from "react";
import { getFormattedMarketAnalysis } from "../marketData";

// Mainnet counterpart to AiCopilot.tsx. Deliberately much thinner:
// testnet's Copilot directly EXECUTES swap/strategy/cross-chain-send by
// signing writeContract calls against FlowFi's own testnet pool
// (POOL_ADDRESS/SWAP_ABI) and CCTP TokenMessenger -- none of which exist
// on mainnet (Pools was never ported; mainnet Bridge/Swap go through
// LI.FI's aggregated routing instead of a fixed contract call this
// component could safely construct on its own). So this version never
// signs anything itself -- for any bridge/swap intent, it just routes the
// user to the matching mainnet tab (mainnetbridge / mainnetswap), same
// "I can't do this myself, here's the page" pattern the testnet Copilot
// already uses for its own "bridge" action. Everything else (general
// questions, market analysis) reuses the exact same approach as
// AiCopilot/AiNarrator: getFormattedMarketAnalysis first, /api/claude
// fallback, no financial advice.
const ANALYSIS_SECTION_HEADERS = new Set([
  "TIMEFRAME", "KEY LEVELS", "MULTI-TIMEFRAME INSIGHT", "WHAT TO WATCH",
  "Tokenomics", "Token Vesting & Unlocks", "PRICE STABILITY", "STABILITY NOTE", "Supply",
]);

function renderMessageContent(content: string | undefined, expanded: boolean) {
  const lines = (content ?? "").split("\n");
  const nodes: JSX.Element[] = [];
  let i = 0;
  if (lines[0]) {
    nodes.push(<div key="title" style={{ fontSize: expanded ? 17 : 14, fontWeight: 800, color: "#111827", marginBottom: 2 }}>{lines[0]}</div>);
    i = 1;
  }
  if (lines[1] && lines[1].startsWith("$")) {
    nodes.push(<div key="price" style={{ fontSize: expanded ? 22 : 16, fontWeight: 800, color: "#6D5EF7", fontFamily: "ui-monospace, monospace", marginBottom: 2 }}>{lines[1]}</div>);
    i = 2;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (ANALYSIS_SECTION_HEADERS.has(trimmed)) {
      nodes.push(<div key={i} style={{ marginTop: 10, marginBottom: 2, paddingTop: 8, borderTop: "1px solid #FDE68A", fontSize: expanded ? 12 : 11, fontWeight: 800, letterSpacing: 0.6, color: "#6D5EF7", textTransform: "uppercase" }}>{trimmed}</div>);
    } else if (trimmed.startsWith("⚠️")) {
      nodes.push(<div key={i} style={{ marginTop: 10, fontSize: expanded ? 12 : 10, color: "#9CA3AF", lineHeight: 1.4 }}>{line}</div>);
    } else if (trimmed.length > 0) {
      nodes.push(<div key={i} style={{ fontSize: expanded ? 14 : 12.5, color: "#374151", lineHeight: 1.55 }}>{line}</div>);
    } else {
      nodes.push(<div key={i} style={{ height: 2 }} />);
    }
  }
  return <>{nodes}</>;
}

type MainnetTab = "mainnetbridge" | "mainnetswap";

interface Props {
  onNavigate: (tab: MainnetTab) => void;
}

interface ParsedIntent {
  action: "bridge" | "swap" | "unknown";
  summary: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  intent?: ParsedIntent;
  confirmed?: boolean;
}

async function parseIntent(text: string): Promise<ParsedIntent> {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system: `You are FlowFi Copilot on the MAINNET side of the app (real funds). You do not execute anything yourself -- your only job is to recognize whether the user wants to (a) bridge/move USDC onto or off Arc mainnet from another chain, or (b) swap tokens on Arc mainnet itself, or (c) neither. Respond with STRICT JSON only, no markdown:
{"action": "bridge" | "swap" | "unknown", "summary": "one short plain-English sentence describing what they want, in the same language they wrote in"}
Use "bridge" for anything crossing chains (e.g. "bring my USDC from Base to Arc", "move 50 USDC to Arc"). Use "swap" for same-chain token exchange on Arc (e.g. "swap USDC for ETH on Arc"). Use "unknown" for anything else, including general questions -- do not force a bridge/swap interpretation onto unrelated requests.`,
      messages: [{ role: "user", content: text }],
    }),
  });
  const data = await response.json();
  if (!data.content) throw new Error(`RAW RESPONSE: ${JSON.stringify(data)}`);
  const raw = data.content?.[0]?.text ?? "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

async function answerGeneralQuestion(text: string): Promise<string> {
  const marketAnswer = await getFormattedMarketAnalysis(text);
  if (marketAnswer) return marketAnswer;
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 250,
      system: `You are FlowFi Copilot (Mainnet). The user's message isn't a bridge/swap request and isn't about a specific coin -- answer briefly and factually. Never recommend buying, selling, or holding anything. Always respond in the same language the user wrote in.`,
      messages: [{ role: "user", content: text }],
    }),
  });
  const data = await response.json();
  if (!data.content) return `(Error: ${data.error?.message || JSON.stringify(data)})`;
  return data.content?.[0]?.text ?? "I couldn't find an answer to that.";
}

export default function AiCopilotMainnet({ onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    try {
      const intent = await parseIntent(text);
      if (intent.action === "unknown") {
        const answer = await answerGeneralQuestion(text);
        setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: intent.summary, intent }]);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : JSON.stringify(err);
      setMessages((prev) => [...prev, { role: "assistant", content: `I couldn't complete that: ${detail}` }]);
    } finally {
      setLoading(false);
    }
  }

  function goToPage(intent: ParsedIntent, msgIndex: number) {
    const targetTab: MainnetTab = intent.action === "bridge" ? "mainnetbridge" : "mainnetswap";
    onNavigate(targetTab);
    const pageLabel = intent.action === "bridge" ? "Bridge" : "Swap";
    setMessages((prev) => [
      ...prev.map((m, i) => (i === msgIndex ? { ...m, confirmed: true } : m)),
      { role: "assistant", content: `Real funds need your own wallet's confirmation, so I've taken you to the ${pageLabel} tab — connect your wallet and complete it there.` },
    ]);
    setOpen(true);
  }

  return (
    <>
      {expanded && open && (
        <div onClick={() => setExpanded(false)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.35)", zIndex: 998 }} />
      )}
      <div style={expanded
        ? { position: "fixed", top: 16, right: 16, bottom: 16, zIndex: 999 }
        : { position: "fixed", bottom: 24, right: 24, zIndex: 999 }}>
      {open && (
        <div style={expanded
          ? { width: "min(560px, calc(100vw - 32px))", height: "100%", background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, boxShadow: "-16px 0 48px rgba(109,94,247,0.16)", display: "flex", flexDirection: "column", overflow: "hidden" }
          : { width: 360, maxHeight: 480, background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, boxShadow: "0 16px 48px rgba(217,119,6,0.2)", display: "flex", flexDirection: "column", marginBottom: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: expanded ? "1.1rem 1.4rem" : "0.9rem 1.1rem", background: "linear-gradient(135deg, #EDE9FE, #FDE68A)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: expanded ? 30 : 24, height: expanded ? 30 : 24, borderRadius: 8, background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: expanded ? 15 : 12, color: "#fff" }}>⚡</div>
              <span style={{ fontSize: expanded ? 16 : 13, fontWeight: 800, color: "#111827" }}>FlowFi Copilot — Mainnet</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setExpanded(!expanded)} title={expanded ? "Shrink" : "Expand"}
                style={{ background: "rgba(109,94,247,0.1)", border: "none", borderRadius: 8, color: "#6D5EF7", cursor: "pointer", fontSize: 13, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {expanded ? "⤡" : "⤢"}
              </button>
              <button onClick={() => { setOpen(false); setExpanded(false); }} style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: expanded ? "1.4rem" : "1rem", display: "flex", flexDirection: "column", gap: expanded ? 14 : 10, minHeight: expanded ? undefined : 200, maxHeight: expanded ? undefined : 320 }}>
            {messages.length === 0 && (
              <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>
                Try: "Bring my USDC from Base to Arc" or "Swap USDC for ETH on Arc". Real funds — I'll take you to the right page to confirm with your own wallet.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: m.role === "user" ? "90%" : "100%" }}>
                <div style={{
                  background: m.role === "user" ? "#6D5EF7" : "#F5F3FF",
                  borderRadius: 12, padding: expanded ? "0.9rem 1.1rem" : "0.6rem 0.8rem", color: m.role === "user" ? "#ffffff" : "#374151",
                }}>
                  {m.role === "assistant" ? renderMessageContent(m.content, expanded) : <span style={{ fontSize: expanded ? 15 : 13 }}>{m.content}</span>}
                </div>
                {m.intent && m.intent.action !== "unknown" && !m.confirmed && (
                  <div style={{ marginTop: 6, background: "#F5F3FF", borderRadius: 12, padding: "0.7rem 0.8rem" }}>
                    <button onClick={() => goToPage(m.intent!, i)}
                      style={{ width: "100%", padding: "0.55rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      Take me there
                    </button>
                  </div>
                )}
                {m.confirmed && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#16A34A", fontWeight: 700 }}>✓ Redirected</div>
                )}
              </div>
            ))}
            {loading && <div style={{ fontSize: 12, color: "#6B7280" }}>Thinking...</div>}
          </div>

          <div style={{ display: "flex", gap: 8, padding: expanded ? "1.2rem 1.4rem" : "0.9rem", borderTop: "1px solid #D4C9FA" }}>
            <input type="text" placeholder="Tell me what to do..." value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              disabled={loading}
              style={{ flex: 1, background: "#F5F3FF", border: "none", borderRadius: 12, padding: expanded ? "0.9rem 1.1rem" : "0.6rem 0.8rem", fontSize: expanded ? 15 : 13, color: "#111827", outline: "none" }} />
            <button onClick={handleSend} disabled={loading || !input.trim()}
              style={{ padding: expanded ? "0.9rem 1.4rem" : "0.6rem 1rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: expanded ? 15 : 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}>
              Send
            </button>
          </div>
        </div>
      )}

      {!expanded && (
        <button onClick={() => setOpen(!open)}
          style={{
            width: 58, height: 58, borderRadius: "50%", border: "none",
            background: "#6D5EF7", color: "#fff", fontSize: 22, cursor: "pointer",
            boxShadow: "0 8px 24px rgba(109,94,247,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          {open ? "✕" : "⚡"}
        </button>
      )}
      </div>
    </>
  );
}

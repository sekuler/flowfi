import { useState } from "react";

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_QUESTIONS = [
  "How is BTC doing today?",
  "Find my last bridge transaction",
  "Where did my USDC go this week?",
  "How much have I sent in total?",
];

// If the AI's answer mentions a full tx hash, turn it into a clickable
// Arcscan link instead of leaving it as inert text the user has to copy.
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

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=30`);
      const data = await res.json();
      const txs = (data.result ?? []).slice(0, 30).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId,
        timestamp: tx.timeStamp,
        value: tx.value,
        status: tx.txreceipt_status,
      }));

      // Real, live market data — never fabricated. If the user asks about
      // BTC/ETH/market conditions, the model answers from this, not memory.
      let marketContext = "";
      try {
        const marketRes = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
        );
        const marketData = await marketRes.json();
        marketContext = `Live market data (USD): BTC $${marketData.bitcoin?.usd} (${marketData.bitcoin?.usd_24h_change?.toFixed(2)}% 24h), ETH $${marketData.ethereum?.usd} (${marketData.ethereum?.usd_24h_change?.toFixed(2)}% 24h), SOL $${marketData.solana?.usd} (${marketData.solana?.usd_24h_change?.toFixed(2)}% 24h).`;
      } catch {
        marketContext = "Live market data was unavailable for this response.";
      }

      const apiKey = (import.meta as any).env.VITE_ANTHROPIC_KEY;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          system: `You are a wallet and market activity narrator for FlowFi. You are given the user's current balances (USDC: ${balances.usdc}, EURC: ${balances.eurc}, USYC: ${balances.usyc}), their recent raw transaction list (method IDs, timestamps, values) from Arc Testnet, and live crypto market data: ${marketContext} Answer the user's question in plain, concise English, grounded ONLY in the data given. If the data doesn't contain enough information to answer precisely, say so honestly rather than guessing. Do not invent transaction details or prices not present in the data.

CRITICAL RULE: You may describe what the market or a price is doing (e.g. "BTC is up 3% today"), but you must NEVER recommend buying, selling, or holding anything, and never say something is a "good time" or "bad time" to trade. If the user asks for a recommendation ("should I buy BTC now?"), politely decline to give financial advice and instead just state the relevant facts you do have (e.g. current price and 24h change), letting them draw their own conclusion. Keep answers under 4 sentences.`,
          messages: [
            { role: "user", content: `Transaction data: ${JSON.stringify(txs)}\n\nQuestion: ${question}` },
          ],
        }),
      });
      const dataRes = await response.json();
      const answer = dataRes.content?.[0]?.text ?? "Could not generate a response.";
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong reading your activity. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 7, background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff" }}>✦</div>
        <span style={{ fontSize: 12, color: "#6D5EF7", fontWeight: 700, letterSpacing: "0.5px" }}>ASK YOUR WALLET</span>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "#6D5EF7" : "#ffffff",
              borderRadius: 12,
              padding: "0.6rem 0.8rem",
              fontSize: 13,
              color: m.role === "user" ? "#ffffff" : "#374151",
              lineHeight: 1.5,
            }}>
              {m.role === "assistant" ? renderWithTxLinks(m.content) : m.content}
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
          style={{ flex: 1, background: "#ffffff", border: "none", borderRadius: 12, padding: "0.6rem 0.9rem", fontSize: 13, color: "#111827", outline: "none" }} />
        <button onClick={() => ask(input)} disabled={loading || !input.trim()}
          style={{ padding: "0.6rem 1rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}>
          Ask
        </button>
      </div>
    </div>
  );
}

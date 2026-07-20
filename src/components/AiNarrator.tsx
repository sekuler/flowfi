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
  "What's my biggest transaction?",
  "Summarize my activity this week",
  "How much have I sent in total?",
];

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
          system: `You are a wallet activity narrator. You are given the user's current balances (USDC: ${balances.usdc}, EURC: ${balances.eurc}, USYC: ${balances.usyc}) and their recent raw transaction list (method IDs, timestamps, values) from Arc Testnet. Answer the user's question in plain, concise English, grounded ONLY in the data given. If the data doesn't contain enough information to answer precisely, say so honestly rather than guessing. Do not invent transaction details not present in the data. Keep answers under 4 sentences.`,
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
    <div style={{ background: "rgba(79,70,229,0.04)", border: "1px solid rgba(79,70,229,0.15)", borderRadius: 14, padding: "1.25rem", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>✦</div>
        <span style={{ fontSize: 12, color: "#a5b4fc", fontWeight: 700, letterSpacing: "0.5px" }}>ASK YOUR WALLET</span>
      </div>

      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUGGESTED_QUESTIONS.map((q) => (
            <button key={q} onClick={() => ask(q)} disabled={loading}
              style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(79,70,229,0.2)", background: "rgba(79,70,229,0.06)", color: "#a5b4fc", fontSize: 11, cursor: "pointer" }}>
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
              background: m.role === "user" ? "rgba(79,70,229,0.15)" : "rgba(255,255,255,0.03)",
              border: m.role === "user" ? "1px solid rgba(79,70,229,0.3)" : "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              padding: "0.6rem 0.8rem",
              fontSize: 13,
              color: m.role === "user" ? "#c7d2fe" : "#cbd5e1",
              lineHeight: 1.5,
            }}>
              {m.content}
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: "#64748b" }}>Reading your activity...</div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input type="text" placeholder="Ask about your wallet activity..." value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
          disabled={loading}
          style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.6rem 0.9rem", fontSize: 13, color: "#f1f5f9", outline: "none" }} />
        <button onClick={() => ask(input)} disabled={loading || !input.trim()}
          style={{ padding: "0.6rem 1rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}>
          Ask
        </button>
      </div>
    </div>
  );
}
import { useState } from "react";
import { buildMarketContext } from "../marketData";

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

      // Real, live market data for whatever coin the user asks about — never
      // fabricated. Works for any coin, not just BTC/ETH/SOL.
      const marketContext = await buildMarketContext(question);

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
          max_tokens: 1100,
          system: `You are FlowFi's assistant. You handle two distinct types of questions:
(1) Questions about the user's own wallet: their current balances (USDC: ${balances.usdc}, EURC: ${balances.eurc}, USYC: ${balances.usyc}) and their recent raw transaction list (method IDs, timestamps, values) from Arc Testnet.
(2) Market/coin analysis questions, using this live market data: ${marketContext}

Answer using only the section relevant to the question — don't mix wallet transaction data into a market analysis answer, and don't mix market data into a wallet question, unless the user's question genuinely spans both. Answer in plain, concise language, grounded ONLY in the data given. If the data doesn't contain enough information to answer precisely, say so honestly rather than guessing. Do not invent transaction details or prices not present in the data.

CRITICAL RULE FOR MARKET ANALYSIS: When the user asks for analysis of a specific coin, you're given real computed technical data: RSI and market structure for 1H, 4H, 1D, and 1W timeframes; EMA20/50; MACD; pivot-based support/resistance (R1-R3, S1-S3); volume; and supply. When the user asks for analysis, ALWAYS use this exact structure, in this order — every section every time, using "n/a" or "not enough data" for anything genuinely missing rather than skipping the section silently:

[Coin] Analysis
Price, market cap, 24h volume, price change (24h / 7d / 30d)

Trend by timeframe
1H: RSI value and read (overbought >70, oversold <30, otherwise neutral), plus market structure
4H: same
1D: same
1W: same
(Never invent a 1M/monthly figure — we don't have reliable data for it, so it's simply not included.)

Key levels (from the 1D pivot data)
Resistance: R1, R2, R3
Support: S1, S2, S3
One hedged, non-predictive line, e.g. "A move above R1 could open the way toward R2" or "If S1 doesn't hold, S2 becomes the next reference point" — use "could"/"may"/"historically", never "will".

Technical structure
Price vs EMA20 and EMA50, and MACD crossover state — current positioning only, never a forecast.

Volume
24h volume, and its relationship to the recent price move only if genuinely inferable from the data (don't invent a volume trend you weren't given).

Market structure summary
One sentence synthesizing the structure across timeframes (e.g. "Short-term structure is choppy while the daily and weekly trends show higher highs and higher lows").

Conclusion
2-3 sentences summarizing the overall technical picture in neutral language — describing what the data shows, never what will happen next and never a trade recommendation.

Disclaimer
End every market-analysis answer with this exact line, translated into the response language: "This analysis is provided for informational and educational purposes only and does not constitute financial, investment, or trading advice. Technical indicators and market data can be inaccurate or change rapidly. Always conduct your own research and make your own decisions."

If asked about token unlocks or news/catalysts, state plainly that no data source is available for that — never invent dates, amounts, or events. You must NEVER recommend buying, selling, or holding anything, and never call something a "good" or "bad" time to trade. Always respond in the same language the user's question is written in. If they want a visual chart, mention they can find live candlestick charts with adjustable timeframes on the Perpetuals page.

For simple factual questions (e.g. just "what's BTC's price"), skip the full report format and just answer directly and briefly — the full report structure is only for when the user actually asks for analysis.`,
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto" }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              background: m.role === "user" ? "#6D5EF7" : "#ffffff",
              borderRadius: 12,
              padding: "0.6rem 0.8rem",
              fontSize: 13,
              color: m.role === "user" ? "#ffffff" : "#374151",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
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

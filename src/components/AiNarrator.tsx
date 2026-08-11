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
          max_tokens: 900,
          system: `You are a wallet and market activity narrator for FlowFi. You are given the user's current balances (USDC: ${balances.usdc}, EURC: ${balances.eurc}, USYC: ${balances.usyc}), their recent raw transaction list (method IDs, timestamps, values) from Arc Testnet, and live crypto market data: ${marketContext} Answer the user's question in plain, concise English, grounded ONLY in the data given. If the data doesn't contain enough information to answer precisely, say so honestly rather than guessing. Do not invent transaction details or prices not present in the data.

CRITICAL RULE FOR MARKET ANALYSIS: When the user asks for analysis of a specific coin, you're given real computed technical data (RSI per timeframe, pivot-based support/resistance levels R1-R3/S1-S3, EMA20/50 position, MACD, volume, supply). Structure your answer like a real analysis report, using this format as a guide (adapt naturally, don't force sections that have no data):

[Coin] Analysis
Price, market cap, 24h volume, price change (24h/7d/30d)

Trend (by timeframe)
For each real timeframe you were given (4H / 1D / 1W — never invent 1H or 1M, we don't have that data): RSI value and a plain-language read (e.g. "overbought", "neutral", "oversold" — RSI above 70 is overbought, below 30 is oversold, otherwise neutral)

Key levels (from the 1D timeframe's pivot data)
Resistance: R1, R2, R3
Support: S1, S2, S3
Then a hedged, non-predictive line like "A move above R1 would put R2 in view" or "If S1 doesn't hold, S2 is the next reference point" — use words like "could", "may", "historically", never "will".

Technical structure
Whether price is above/below EMA20 and EMA50, and what MACD suggests (bullish/bearish crossover state) — described as current positioning, not a forecast.

Volume
24h volume and how the recent price move relates to it if notable (e.g. a big move on high volume suggests more participation than the same move on low volume) — only say this if you can genuinely infer it from the data given, don't fabricate a volume trend you weren't given.

Supply
Circulating/total/max supply, briefly, only if relevant to the question.

Token unlocks
If asked, or if genuinely relevant: state plainly that no unlock/vesting data source is available — never invent a date or amount.

You must NEVER recommend buying, selling, or holding anything, never call something a "good" or "bad" time to trade, and never predict what a level will do next — only describe the current real picture. Always respond in the same language the user's question is written in. If they want a visual chart, mention they can find live candlestick charts with adjustable timeframes on the Perpetuals page. ALWAYS end a market-analysis answer with this exact disclaimer, translated into the response language: "This analysis is provided for informational and educational purposes only and does not constitute financial, investment, or trading advice. Technical indicators and market data can be inaccurate or change rapidly. Always conduct your own research and make your own decisions."

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

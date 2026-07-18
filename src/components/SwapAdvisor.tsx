import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "../chains";

const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;

const SWAP_ABI = [
  { type: "function", name: "getLiquidity", stateMutability: "view", inputs: [], outputs: [{ name: "usdcBalance", type: "uint256" }, { name: "eurcBalance", type: "uint256" }] },
] as const;

interface Props {
  tokenIn: "USDC" | "EURC";
  tokenOut: "USDC" | "EURC";
  amountIn: string;
  amountOut: string;
}

interface Advisory {
  score: number;
  stars: number;
  label: string;
  poolImpact: number;
  poolLiquidityOut: string;
  recommendation: string;
  splitSuggestion: number | null;
}

function scoreFromImpact(impact: number): { score: number; stars: number; label: string } {
  if (impact < 0.01) return { score: 95, stars: 5, label: "Good Time" };
  if (impact < 0.05) return { score: 80, stars: 4, label: "Good Time" };
  if (impact < 0.15) return { score: 60, stars: 3, label: "Caution" };
  if (impact < 0.3) return { score: 35, stars: 2, label: "Wait" };
  return { score: 15, stars: 1, label: "High Risk" };
}

export default function SwapAdvisor({ tokenIn, tokenOut, amountIn, amountOut }: Props) {
  const [advisory, setAdvisory] = useState<Advisory | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = useCallback(async () => {
    if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0 || !amountOut || Number(amountOut) <= 0) {
      setAdvisory(null);
      return;
    }
    setLoading(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [usdcBal, eurcBal] = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "getLiquidity" });
      const poolOut = tokenOut === "USDC" ? Number(formatUnits(usdcBal, 6)) : Number(formatUnits(eurcBal, 6));
      const out = Number(amountOut);
      const impact = poolOut > 0 ? out / poolOut : 1;

      const { score, stars, label } = scoreFromImpact(impact);
      const splitSuggestion = impact >= 0.15 ? Math.ceil(impact / 0.04) : null;

      let recommendation = "";
      try {
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
            max_tokens: 150,
            system: "You are a swap risk advisor for a DeFi app. You are given real on-chain pool data. Write a 2-3 sentence recommendation in English, grounded ONLY in the numbers given. Never invent data not provided. Be direct and concrete.",
            messages: [
              {
                role: "user",
                content: `Swap: ${amountIn} ${tokenIn} -> ${amountOut} ${tokenOut}. Pool liquidity available for ${tokenOut}: ${poolOut.toFixed(4)}. This swap would consume ${(impact * 100).toFixed(2)}% of that pool's liquidity. Give your recommendation.`,
              },
            ],
          }),
        });
        const data = await response.json();
        recommendation = data.content?.[0]?.text ?? "";
      } catch {
        recommendation = impact < 0.05
          ? "Pool liquidity is sufficient for this swap size relative to available reserves."
          : "This swap would consume a significant portion of available pool liquidity. Consider a smaller amount.";
      }

      setAdvisory({
        score, stars, label,
        poolImpact: impact * 100,
        poolLiquidityOut: poolOut.toFixed(2),
        recommendation,
        splitSuggestion,
      });
    } catch (e) {
      console.log("SwapAdvisor error:", e);
      setAdvisory(null);
    } finally {
      setLoading(false);
    }
  }, [tokenIn, tokenOut, amountIn, amountOut]);

  useEffect(() => {
    const t = setTimeout(analyze, 500);
    return () => clearTimeout(t);
  }, [analyze]);

  if (!amountIn || Number(amountIn) <= 0) return null;

  return (
    <div style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, letterSpacing: "0.5px" }}>SWAP ADVISOR</span>
        {loading && <span style={{ fontSize: 11, color: "#64748b" }}>Analyzing...</span>}
      </div>

      {advisory && !loading && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 2 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} style={{ fontSize: 16, color: i <= advisory.stars ? "#fbbf24" : "#334155" }}>★</span>
              ))}
            </div>
            <span style={{
              fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              color: advisory.stars >= 4 ? "#6ee7b7" : advisory.stars >= 3 ? "#fbbf24" : "#fca5a5",
              background: advisory.stars >= 4 ? "rgba(16,185,129,0.1)" : advisory.stars >= 3 ? "rgba(234,179,8,0.1)" : "rgba(239,68,68,0.1)",
            }}>
              {advisory.label}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b" }}>Pool Impact</span>
              <span style={{ color: advisory.poolImpact > 15 ? "#fca5a5" : "#e2e8f0", fontWeight: 600 }}>{advisory.poolImpact.toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b" }}>Pool Liquidity</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{advisory.poolLiquidityOut} {tokenOut}</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "0.65rem 0.8rem" }}>
            <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, margin: 0 }}>{advisory.recommendation}</p>
          </div>

          {advisory.splitSuggestion && (
            <div style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 8, padding: "0.65rem 0.8rem" }}>
              <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>
                💡 Consider splitting into {advisory.splitSuggestion} smaller swaps to reduce pool impact per transaction.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
import SwapAdvisor from "./SwapAdvisor";
import AdminRate from "./AdminRate";
import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";

const SWAP_STEPS = ["Approving token", "Swapping", "Done"];
function swapStepIndex(state: string) {
  if (state === "approving") return 0;
  if (state === "swapping") return 1;
  if (state === "done") return 2;
  return -1;
}

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;

const SWAP_ABI = [
  { type: "function", name: "swapUsdcToEurc", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }], outputs: [] },
  { type: "function", name: "swapEurcToUsdc", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }], outputs: [] },
  { type: "function", name: "getEurcOut", stateMutability: "view", inputs: [{ name: "usdcIn", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getUsdcOut", stateMutability: "view", inputs: [{ name: "eurcIn", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "usdcToEurcRate", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getLiquidity", stateMutability: "view", inputs: [], outputs: [{ name: "usdcBalance", type: "uint256" }, { name: "eurcBalance", type: "uint256" }] },
] as const;

const TOKENS = ["USDC", "EURC"] as const;
type Token = (typeof TOKENS)[number];

interface Props {
  provider: EIP1193Provider;
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onRefresh: () => void;
}

interface ContractTx {
  hash: string;
  age: string;
  method: string;
}

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function switchToArc(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    } else throw e;
  }
}

export default function SwapForm({ provider, address, balances, onRefresh }: Props) {
  const [tokenIn, setTokenIn] = useState<Token>("USDC");
  const [tokenOut, setTokenOut] = useState<Token>("EURC");
  const [amount, setAmount] = useState("");
  const [estimatedOut, setEstimatedOut] = useState("0.00");
  const [swapState, setSwapState] = useState<"idle" | "approving" | "swapping" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [poolRate, setPoolRate] = useState<number | null>(null);
  const [marketRate, setMarketRate] = useState<number | null>(null);
  const [rateStale, setRateStale] = useState(false);
  const [poolLiquidity, setPoolLiquidity] = useState<{ usdc: string; eurc: string } | null>(null);
  const [contractTxs, setContractTxs] = useState<ContractTx[]>([]);

  const currentBalance = tokenIn === "USDC" ? (balances.usdc ?? "...") : (balances.eurc ?? "...");

  const estimate = useCallback(async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setEstimatedOut("0.00"); return; }
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const amountIn = parseUnits(amount, 6);
      const out = tokenIn === "USDC"
        ? await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "getEurcOut", args: [amountIn] })
        : await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "getUsdcOut", args: [amountIn] });
      setEstimatedOut(Number(formatUnits(out as bigint, 6)).toFixed(4));
    } catch {
      setEstimatedOut("0.00");
    }
  }, [amount, tokenIn]);

  useEffect(() => { estimate(); }, [estimate]);

  useEffect(() => {
    async function checkRates() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const rate = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "usdcToEurcRate" });
        const pool = Number(rate) / 1e6;
        setPoolRate(pool);

        const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
        const data = await res.json();
        const market = data.rates?.EUR;
        if (market) {
          setMarketRate(market);
          const diff = Math.abs(pool - market) / market;
          setRateStale(diff > 0.01);
        }
      } catch {
        /* ignore, silently skip staleness check */
      }
    }
    checkRates();
  }, []);

  useEffect(() => {
    async function loadMarketInfo() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const [usdcBal, eurcBal] = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "getLiquidity" });
        setPoolLiquidity({ usdc: Number(formatUnits(usdcBal, 6)).toFixed(2), eurc: Number(formatUnits(eurcBal, 6)).toFixed(2) });
      } catch {
        setPoolLiquidity(null);
      }

      try {
        const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${SWAP_CONTRACT}&limit=8`);
        const data = await res.json();
        const items: ContractTx[] = (data.result ?? []).slice(0, 8).map((tx: any) => ({
          hash: tx.hash,
          age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
          method: tx.methodId === "0x9cd441da" || tx.methodId === "0x74b30078" ? "Swap" : "Contract Call",
        }));
        setContractTxs(items);
      } catch {
        setContractTxs([]);
      }
    }
    loadMarketInfo();
    const interval = setInterval(loadMarketInfo, 45000);
    return () => clearInterval(interval);
  }, [txHash]);

  function flipTokens() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount("");
    setEstimatedOut("0.00");
  }

  async function doSwap() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null); setTxHash(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const amountIn = parseUnits(amount, 6);
      const tokenAddress = tokenIn === "USDC" ? USDC_ADDRESS : EURC_ADDRESS;

      setSwapState("approving");
      const approveHash = await wc.writeContract({
        address: tokenAddress, abi: erc20Abi, functionName: "approve",
        args: [SWAP_CONTRACT, amountIn], account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setSwapState("swapping");
      const hash = await wc.writeContract({
        address: SWAP_CONTRACT, abi: SWAP_ABI,
        functionName: tokenIn === "USDC" ? "swapUsdcToEurc" : "swapEurcToUsdc",
        args: [amountIn], account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setTxHash(hash); setSwapState("done"); setAmount(""); setEstimatedOut("0.00");
      showToast("Swap completed", "success");
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Unexpected error."); setSwapState("error");
    }
  }

  const isLoading = swapState === "approving" || swapState === "swapping";
  const tickerItems = contractTxs.length > 0 ? contractTxs : [];

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div className="flowfi-blob" style={{ position: "absolute", top: -100, left: -80, width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.35) 0%, transparent 70%)", filter: "blur(50px)", pointerEvents: "none", zIndex: 0 }} />
<div className="flowfi-blob" style={{ position: "absolute", bottom: -80, right: -60, width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)", filter: "blur(50px)", pointerEvents: "none", zIndex: 0, animationDelay: "-10s" }} />
      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.25rem", alignItems: "start", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>From</label>
                <span style={{ fontSize: 11, color: "#475569" }}>Balance: {currentBalance} {tokenIn}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {TOKENS.map((t) => (
                  <button key={t} onClick={() => { if (t !== tokenIn) flipTokens(); }} disabled={isLoading}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: tokenIn === t ? "2px solid #8b5cf6" : "1px solid rgba(255,255,255,0.08)", background: tokenIn === t ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.03)", color: tokenIn === t ? "#a78bfa" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {t}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
                <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>{tokenIn}</span>
              </div>
              <button onClick={() => setAmount(currentBalance)} disabled={isLoading}
                style={{ alignSelf: "flex-end", background: "none", border: "none", color: "#a78bfa", fontSize: 12, cursor: "pointer", padding: 0 }}>
                Max
              </button>
            </div>

            <button onClick={flipTokens} disabled={isLoading}
              style={{ alignSelf: "center", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, padding: "6px 16px", color: "#a78bfa", fontSize: 16, cursor: "pointer" }}>
              ⇅
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>To (estimated)</label>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>{estimatedOut}</span>
                <span style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>{tokenOut}</span>
              </div>
            </div>

            {rateStale && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "0.65rem 0.8rem" }}>
                <p style={{ fontSize: 12, color: "#fca5a5", margin: 0 }}>
                  ⚠️ Pool rate ({poolRate?.toFixed(4)}) differs from live market rate ({marketRate?.toFixed(4)}) by more than 1%. This swap uses the pool's fixed rate, not the live market rate.
                </p>
              </div>
            )}

            {amount && Number(amount) > 0 && Number(estimatedOut) > 0 && (
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.85rem 1rem", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>You Receive</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{estimatedOut} {tokenOut}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Rate</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>1 {tokenIn} = {tokenIn === "USDC" ? poolRate?.toFixed(4) : (poolRate ? (1 / poolRate).toFixed(4) : "...")} {tokenOut}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Fee</span>
                  <span style={{ color: "#6ee7b7", fontWeight: 600 }}>0% — fixed-rate pool</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Minimum Received</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{estimatedOut} {tokenOut}</span>
                </div>
              </div>
            )}

            <SwapAdvisor tokenIn={tokenIn} tokenOut={tokenOut} amountIn={amount} amountOut={estimatedOut} />

            {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

            {txHash && swapState === "done" && (
              <div style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 10, padding: "1rem" }}>
                <p style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 6 }}>Swap successful!</p>
                <a href={"https://testnet.arcscan.app/tx/" + txHash} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on Explorer</a>
              </div>
            )}
{(isLoading || swapState === "done") && (
  <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "0.5rem 0" }}>
    {SWAP_STEPS.map((label, i) => {
      const current = swapStepIndex(swapState);
      const done = i < current || swapState === "done";
      const active = i === current && swapState !== "done";
      return (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700,
            background: done ? "#22d3ee" : active ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.06)",
            color: done ? "#0a1a2f" : active ? "#a78bfa" : "#475569",
            border: active ? "1px solid #8b5cf6" : "none",
          }}>
            {done ? "✓" : i + 1}
          </div>
          <span style={{ fontSize: 11, color: done ? "#22d3ee" : active ? "#a78bfa" : "#475569" }}>{label}</span>
          {i < SWAP_STEPS.length - 1 && <span style={{ width: 16, height: 1, background: "rgba(255,255,255,0.1)" }} />}
        </div>
      );
    })}
  </div>
)}

            <button onClick={swapState === "error" ? () => { setSwapState("idle"); setErrorMsg(null); } : doSwap}
              disabled={isLoading || swapState === "done"}
              style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #7c3aed, #8b5cf6)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading || swapState === "done" ? "not-allowed" : "pointer", opacity: isLoading || swapState === "done" ? 0.6 : 1 }}>
              {swapState === "idle" && "Swap"}
              {swapState === "approving" && "Approving..."}
              {swapState === "swapping" && "Swapping..."}
              {swapState === "done" && "Done!"}
              {swapState === "error" && "Try Again"}
            </button>

            {swapState === "done" && (
              <button onClick={() => { setSwapState("idle"); setTxHash(null); }}
                style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                New Swap
              </button>
            )}
          </div>

          <div style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 10, padding: "0.75rem 1rem" }}>
            <p style={{ fontSize: 12, color: "#a78bfa" }}>
              Pool rate: 1 USDC ≈ {poolRate?.toFixed(4) ?? "..."} EURC
              {marketRate && <span style={{ color: "#64748b" }}> · Live market: {marketRate.toFixed(4)}</span>}
              {" · Powered by ArcSwap"}
            </p>
            <AdminRate provider={provider} address={address} />
          </div>

          {tickerItems.length > 0 && (
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.7rem 0", display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
              <span style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700, paddingLeft: 14, flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee" }} />
                LIVE
              </span>
              <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
                <div className="flowfi-ticker-track" style={{ display: "flex", gap: 32, whiteSpace: "nowrap", width: "max-content" }}>
                  {[...tickerItems, ...tickerItems].map((tx, i) => (
                    <span key={i} style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>
                      {tx.method} · {tx.age}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.1rem" }}>
            <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>MARKET INFO</div>
            {poolLiquidity ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>USDC in pool</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{poolLiquidity.usdc}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>EURC in pool</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{poolLiquidity.eurc}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Pool rate</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{poolRate?.toFixed(4) ?? "..."}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Live EUR/USD</span>
                  <span style={{ color: marketRate ? "#e2e8f0" : "#475569", fontWeight: 700 }}>{marketRate?.toFixed(4) ?? "—"}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>
            )}
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.1rem" }}>
            <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT ACTIVITY</div>
            {contractTxs.length === 0 && <div style={{ fontSize: 12, color: "#334155" }}>No recent activity.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {contractTxs.map((tx) => (
                <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.7rem", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
                  <span style={{ fontSize: 11, color: "#a78bfa", fontWeight: 600 }}>{tx.method}</span>
                  <span style={{ fontSize: 11, color: "#334155" }}>{tx.age}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

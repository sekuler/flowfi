import SwapAdvisor from "./SwapAdvisor";
import AdminRate from "./AdminRate";
import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo } from "../circleWalletHelpers";

const SWAP_STEPS = ["Approving", "Swapping", "Done"];
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
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://arc-testnet.g.alchemy.com/v2/alch_1L2dTNapY_mz3YEIsoVEN"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    } else throw e;
  }
}

const DEMO_TICKER: ContractTx[] = [
  { hash: "demo1", age: "12s ago", method: "Swap" },
  { hash: "demo2", age: "45s ago", method: "Swap" },
  { hash: "demo3", age: "1m ago", method: "Swap" },
  { hash: "demo4", age: "3m ago", method: "Swap" },
  { hash: "demo5", age: "5m ago", method: "Swap" },
];

export default function SwapForm({ provider, address, balances, onRefresh }: Props) {
  const [tokenIn, setTokenIn] = useState<Token>("USDC");
  const [tokenOut, setTokenOut] = useState<Token>("EURC");
  const [amount, setAmount] = useState("");
  const [estimatedOut, setEstimatedOut] = useState("0.00");
  const [swapState, setSwapState] = useState<"idle" | "approving" | "swapping" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenInOpen, setTokenInOpen] = useState(false);
  const [tokenOutOpen, setTokenOutOpen] = useState(false);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);
  const [circleBalances, setCircleBalances] = useState<{ usdc: string; eurc: string } | null>(null);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
  }, []);

  useEffect(() => {
    if (!useCircle || !circleWallet) return;
    let cancelled = false;
    async function loadCircleBalances() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const [usdc, eurc] = await Promise.all([
          client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [circleWallet!.address as `0x${string}`] }),
          client.readContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [circleWallet!.address as `0x${string}`] }),
        ]);
        if (!cancelled) setCircleBalances({ usdc: Number(formatUnits(usdc, 6)).toFixed(2), eurc: Number(formatUnits(eurc, 6)).toFixed(2) });
      } catch {
        if (!cancelled) setCircleBalances({ usdc: "—", eurc: "—" });
      }
    }
    loadCircleBalances();
    const interval = setInterval(loadCircleBalances, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [useCircle, circleWallet]);

  const [poolRate, setPoolRate] = useState<number | null>(null);
  const [marketRate, setMarketRate] = useState<number | null>(null);
  const [rateStale, setRateStale] = useState(false);
  const [poolLiquidity, setPoolLiquidity] = useState<{ usdc: string; eurc: string } | null>(null);
  const [contractTxs, setContractTxs] = useState<ContractTx[]>([]);

  const activeBalances = useCircle && circleBalances ? circleBalances : { usdc: balances.usdc ?? "...", eurc: balances.eurc ?? "..." };
  const currentBalance = tokenIn === "USDC" ? activeBalances.usdc : activeBalances.eurc;

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
    const amountIn = parseUnits(amount, 6);
    const tokenAddress = tokenIn === "USDC" ? USDC_ADDRESS : EURC_ADDRESS;

    if (useCircle && circleWallet) {
      const arcWalletId = getWalletIdForChain(circleWallet, "ARC-TESTNET");
      if (!arcWalletId) { setErrorMsg("Circle Wallet has no Arc Testnet account."); setSwapState("error"); return; }
      try {
        setSwapState("approving");
        await circleContractCallAndWait({
          walletId: arcWalletId,
          contractAddress: tokenAddress,
          abiFunctionSignature: "approve(address,uint256)",
          abiParameters: [SWAP_CONTRACT, amountIn.toString()],
        });

        setSwapState("swapping");
        const hash = await circleContractCallAndWait({
          walletId: arcWalletId,
          contractAddress: SWAP_CONTRACT,
          abiFunctionSignature: tokenIn === "USDC" ? "swapUsdcToEurc(uint256)" : "swapEurcToUsdc(uint256)",
          abiParameters: [amountIn.toString()],
        });

        setTxHash(hash); setSwapState("done"); setAmount(""); setEstimatedOut("0.00");
        showToast("Swap completed", "success");
      } catch (e: unknown) {
        const err = e as { message?: string };
        setErrorMsg(err.message ?? "Unexpected error."); setSwapState("error");
      }
      return;
    }

    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

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
  const tickerItems = contractTxs.length > 0 ? contractTxs : DEMO_TICKER;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem", alignItems: "start", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

          <div style={{ background: "#0b1220", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>

            {circleWallet && (
              <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <button onClick={() => setUseCircle(false)} disabled={isLoading}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: !useCircle ? "#1b2740" : "#111a2c", color: !useCircle ? "#67e8f9" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Browser Wallet
                </button>
                <button onClick={() => setUseCircle(true)} disabled={isLoading}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: useCircle ? "#1b2740" : "#111a2c", color: useCircle ? "#67e8f9" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Circle Wallet
                </button>
              </div>
            )}

            <div style={{ borderRadius: 16, background: "#111a2c", padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: "0.5px" }}>You pay</span>
                <span style={{ fontSize: 11, color: "#475569" }}>Balance: {currentBalance} {tokenIn}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 32, color: "#f8fafc", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenInOpen(!tokenInOpen)}
                    disabled={isLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#1b2740", border: "none", cursor: "pointer" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#22d3ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#04121f" }}>{tokenIn[0]}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{tokenIn}</span>
                    <span style={{ fontSize: 9, color: "#64748b" }}>▾</span>
                  </button>
                  {tokenInOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: "#141d33", borderRadius: 12, padding: 6, minWidth: 140, boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
                      {TOKENS.map((t) => (
                        <button key={t} disabled={t === tokenIn}
                          onClick={() => { setTokenIn(t); setTokenOut(t === "USDC" ? "EURC" : "USDC"); setTokenInOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t === tokenIn ? "rgba(34,211,238,0.1)" : "transparent", border: "none", cursor: t === tokenIn ? "not-allowed" : "pointer", opacity: t === tokenIn ? 0.4 : 1 }}>
                          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#22d3ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#04121f" }}>{t[0]}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setAmount(currentBalance)} disabled={isLoading}
                style={{ marginTop: 6, background: "none", border: "none", color: "#22d3ee", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                Max
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: -10, marginBottom: -10, position: "relative", zIndex: 1 }}>
              <button onClick={flipTokens} disabled={isLoading}
                style={{ width: 32, height: 32, borderRadius: 10, background: "#0b1220", border: "3px solid #0b1220", color: "#22d3ee", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ↓
              </button>
            </div>

            <div style={{ borderRadius: 16, background: "#111a2c", padding: "1rem 1.1rem" }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 10 }}>You receive</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: "#f8fafc", fontFamily: "ui-monospace, monospace" }}>{estimatedOut}</span>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenOutOpen(!tokenOutOpen)}
                    disabled={isLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#1b2740", border: "none", cursor: "pointer" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#22d3ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#04121f" }}>{tokenOut[0]}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{tokenOut}</span>
                    <span style={{ fontSize: 9, color: "#64748b" }}>▾</span>
                  </button>
                  {tokenOutOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: "#141d33", borderRadius: 12, padding: 6, minWidth: 140, boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
                      {TOKENS.map((t) => (
                        <button key={t} disabled={t === tokenOut}
                          onClick={() => { setTokenOut(t); setTokenIn(t === "USDC" ? "EURC" : "USDC"); setTokenOutOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t === tokenOut ? "rgba(34,211,238,0.1)" : "transparent", border: "none", cursor: t === tokenOut ? "not-allowed" : "pointer", opacity: t === tokenOut ? 0.4 : 1 }}>
                          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#22d3ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#04121f" }}>{t[0]}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {rateStale && (
              <div style={{ background: "rgba(239,68,68,0.1)", borderRadius: 10, padding: "0.65rem 0.8rem" }}>
                <p style={{ fontSize: 12, color: "#fca5a5", margin: 0 }}>
                  Pool rate ({poolRate?.toFixed(4)}) differs from the live market rate ({marketRate?.toFixed(4)}) by more than 1%. This swap uses the pool's fixed rate.
                </p>
              </div>
            )}

            {amount && Number(amount) > 0 && Number(estimatedOut) > 0 && (
              <div style={{ background: "#0d1626", borderRadius: 12, padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>You receive</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{estimatedOut} {tokenOut}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Rate</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>1 {tokenIn} = {tokenIn === "USDC" ? poolRate?.toFixed(4) : (poolRate ? (1 / poolRate).toFixed(4) : "...")} {tokenOut}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Fee</span>
                  <span style={{ color: "#34d399", fontWeight: 600 }}>0% — fixed-rate pool</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Minimum received</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{estimatedOut} {tokenOut}</span>
                </div>
              </div>
            )}

            <SwapAdvisor tokenIn={tokenIn} tokenOut={tokenOut} amountIn={amount} amountOut={estimatedOut} />

            {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

            {txHash && swapState === "done" && (
              <div style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", borderRadius: 12, padding: "1rem" }}>
                <p style={{ color: "#22d3ee", fontWeight: 700, marginBottom: 6 }}>Swap successful!</p>
                <a href={"https://testnet.arcscan.app/tx/" + txHash} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on explorer</a>
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
                        background: done ? "#22d3ee" : active ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.06)",
                        color: done ? "#04121f" : active ? "#a5b4fc" : "#475569",
                        border: active ? "1px solid #6366f1" : "none",
                      }}>
                        {done ? "✓" : i + 1}
                      </div>
                      <span style={{ fontSize: 11, color: done ? "#22d3ee" : active ? "#a5b4fc" : "#475569" }}>{label}</span>
                      {i < SWAP_STEPS.length - 1 && <span style={{ width: 16, height: 1, background: "rgba(255,255,255,0.1)" }} />}
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={swapState === "error" ? () => { setSwapState("idle"); setErrorMsg(null); } : doSwap}
              disabled={isLoading || swapState === "done"}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#22d3ee", color: "#04121f", fontSize: 16, fontWeight: 700, cursor: isLoading || swapState === "done" ? "not-allowed" : "pointer", opacity: isLoading || swapState === "done" ? 0.5 : 1, marginTop: 4 }}>
              {swapState === "idle" && "Swap"}
              {swapState === "approving" && "Approving..."}
              {swapState === "swapping" && "Swapping..."}
              {swapState === "done" && "Done!"}
              {swapState === "error" && "Try again"}
            </button>

            {swapState === "done" && (
              <button onClick={() => { setSwapState("idle"); setTxHash(null); }}
                style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#64748b", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                New swap
              </button>
            )}
          </div>

          <div style={{ background: "#0b1220", borderRadius: 14, padding: "0.75rem 1rem" }}>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
              Pool rate: 1 USDC ≈ {poolRate?.toFixed(4) ?? "..."} EURC
              {marketRate && <span> · Live market: {marketRate.toFixed(4)}</span>}
            </p>
            <AdminRate provider={provider} address={address} />
          </div>

        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ background: "#0b1220", borderRadius: 18, padding: "1.1rem" }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>ROUTE DETAILS</div>
            {poolLiquidity ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#64748b" }}>USDC in pool</span>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolLiquidity.usdc}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#64748b" }}>EURC in pool</span>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolLiquidity.eurc}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#64748b" }}>Pool rate</span>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolRate?.toFixed(4) ?? "..."}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#64748b" }}>Live EUR/USD</span>
                  <span style={{ color: marketRate ? "#f1f5f9" : "#475569", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{marketRate?.toFixed(4) ?? "—"}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#475569" }}>Loading...</div>
            )}
          </div>

          <div style={{ background: "#0b1220", borderRadius: 18, padding: "1.1rem" }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT ACTIVITY</div>
            {contractTxs.length === 0 && <div style={{ fontSize: 12, color: "#475569" }}>No recent activity yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {contractTxs.map((tx) => (
                <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.7rem", borderRadius: 10, background: "#111a2c", textDecoration: "none" }}>
                  <span style={{ fontSize: 11, color: "#22d3ee", fontWeight: 600 }}>{tx.method}</span>
                  <span style={{ fontSize: 11, color: "#475569" }}>{tx.age}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, marginTop: "0.75rem", background: "#0b1220", borderRadius: 14, padding: "0.7rem 0", display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
        <span style={{ fontSize: 11, color: "#22d3ee", fontWeight: 700, paddingLeft: 14, flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee" }} />
          LIVE
        </span>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <div className="flowfi-ticker-track" style={{ display: "flex", gap: 32, whiteSpace: "nowrap", width: "max-content" }}>
            {[...tickerItems, ...tickerItems].map((tx, i) => (
              <span key={i} style={{ fontSize: 12, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                {tx.method} · {tx.age}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import SwapAdvisor from "./SwapAdvisor";
import AdminRate from "./AdminRate";
import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import { addPoints } from "../gamification";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo } from "../circleWalletHelpers";
import { getDCAPlan, setDCAPlan, clearDCAPlan, markDCAExecuted, isDCADue, type DCAPlan, type DCAFrequency } from "../dca";

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
const POOL_FACTORY_V2 = "0xE610D2f76547c2a3073e1273E7BFA80d395eCDf8" as `0x${string}`;

const POOL_FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_V2_ABI = [
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

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
  const [dcaPlan, setDcaPlanState] = useState<DCAPlan | null>(null);
  const [dcaAmount, setDcaAmount] = useState("20");
  const [dcaFrequency, setDcaFrequency] = useState<DCAFrequency>("weekly");
  const [runningDCA, setRunningDCA] = useState(false);

  useEffect(() => { setDcaPlanState(getDCAPlan()); }, []);
  const [useCircle, setUseCircle] = useState(false);
  const [circleBalances, setCircleBalances] = useState<{ usdc: string; eurc: string } | null>(null);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
    function handleWalletChange() { setCircleWallet(getCircleWallet()); }
    window.addEventListener("circle-wallet-changed", handleWalletChange);
    return () => window.removeEventListener("circle-wallet-changed", handleWalletChange);
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
  const [legacyOut, setLegacyOut] = useState<string | null>(null);
  const [legacyPoolAddress, setLegacyPoolAddress] = useState<`0x${string}` | null>(null);
  const [useLegacyRoute, setUseLegacyRoute] = useState(false);

  const activeBalances = useCircle && circleBalances ? circleBalances : { usdc: balances.usdc ?? "...", eurc: balances.eurc ?? "..." };
  const currentBalance = tokenIn === "USDC" ? activeBalances.usdc : activeBalances.eurc;

  const estimate = useCallback(async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setEstimatedOut("0.00"); setLegacyOut(null); return; }
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const amountIn = parseUnits(amount, 6);
      const out = tokenIn === "USDC"
        ? await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "getEurcOut", args: [amountIn] })
        : await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "getUsdcOut", args: [amountIn] });
      setEstimatedOut(Number(formatUnits(out as bigint, 6)).toFixed(4));

      // Compare against a real Pool Factory V2 pool for USDC/EURC, if one
      // exists — a second genuine liquidity source on FlowFi, so the better
      // route can be surfaced instead of only ever showing the fixed-rate pool.
      try {
        const poolAddress = await client.readContract({
          address: POOL_FACTORY_V2, abi: POOL_FACTORY_ABI, functionName: "getPool",
          args: [USDC_ADDRESS, EURC_ADDRESS],
        }) as `0x${string}`;
        if (poolAddress === "0x0000000000000000000000000000000000000000") {
          setLegacyOut(null);
        } else {
          const legacyOutRaw = await client.readContract({
            address: poolAddress, abi: POOL_V2_ABI, functionName: "getAmountOut",
            args: [tokenIn === "USDC", amountIn],
          });
          setLegacyOut(Number(formatUnits(legacyOutRaw as bigint, 6)).toFixed(4));
          setLegacyPoolAddress(poolAddress);
        }
      } catch (legacyErr) {
        console.error("Pool V2 quote failed:", legacyErr);
        setLegacyOut(null);
      }
    } catch {
      setEstimatedOut("0.00");
      setLegacyOut(null);
    }
  }, [amount, tokenIn]);

  useEffect(() => { estimate(); }, [estimate]);

  // Auto-pick whichever route quotes more, so the toggle below reflects the
  // actual best price rather than defaulting to the fixed-rate pool.
  useEffect(() => {
    if (legacyOut && Number(legacyOut) > Number(estimatedOut)) setUseLegacyRoute(true);
    else setUseLegacyRoute(false);
  }, [legacyOut, estimatedOut]);

  useEffect(() => {
    async function checkRates() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const rate = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "usdcToEurcRate" });
        const pool = Number(rate) / 1e6;
        setPoolRate(pool);

        const res = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=EUR");
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
      addPoints(10);
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
      const routeContract = useLegacyRoute && legacyPoolAddress ? legacyPoolAddress : SWAP_CONTRACT;

      setSwapState("approving");
      const approveHash = await wc.writeContract({
        address: tokenAddress, abi: erc20Abi, functionName: "approve",
        args: [routeContract, amountIn], account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setSwapState("swapping");
      const hash = useLegacyRoute && legacyPoolAddress
        ? await wc.writeContract({
            address: legacyPoolAddress, abi: POOL_V2_ABI, functionName: "swap",
            args: [tokenIn === "USDC", amountIn, legacyOut ? (parseUnits(legacyOut, 6) * 99n) / 100n : 0n], account: address as `0x${string}`,
          })
        : await wc.writeContract({
            address: SWAP_CONTRACT, abi: SWAP_ABI,
            functionName: tokenIn === "USDC" ? "swapUsdcToEurc" : "swapEurcToUsdc",
            args: [amountIn], account: address as `0x${string}`,
          });
      await publicClient.waitForTransactionReceipt({ hash });

      setTxHash(hash); setSwapState("done"); setAmount(""); setEstimatedOut("0.00");
      showToast("Swap completed", "success");
      addPoints(10);
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Unexpected error."); setSwapState("error");
    }
  }

  const isLoading = swapState === "approving" || swapState === "swapping";

  async function executeDCANow() {
    if (!dcaPlan || runningDCA) return;
    setRunningDCA(true);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const amountIn = parseUnits(String(dcaPlan.amount), 6);

      const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [SWAP_CONTRACT, amountIn], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const hash = await wc.writeContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "swapUsdcToEurc", args: [amountIn], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      markDCAExecuted();
      setDcaPlanState(getDCAPlan());
      addPoints(10);
      showToast(`DCA buy complete: ${dcaPlan.amount} USDC → EURC`, "success");
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast(err.message ?? "DCA buy failed.", "error");
    } finally {
      setRunningDCA(false);
    }
  }
  const tickerItems = contractTxs.length > 0 ? contractTxs : DEMO_TICKER;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem", alignItems: "start", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

          <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>

            {circleWallet && (
              <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <button onClick={() => setUseCircle(false)} disabled={isLoading}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: !useCircle ? "#ede9fe" : "#f5f3ff", color: !useCircle ? "#5B21B6" : "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Browser Wallet
                </button>
                <button onClick={() => setUseCircle(true)} disabled={isLoading}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: useCircle ? "#ede9fe" : "#f5f3ff", color: useCircle ? "#5B21B6" : "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Circle Wallet
                </button>
              </div>
            )}

            <div style={{ borderRadius: 16, background: "#f5f3ff", padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px" }}>You pay</span>
                <span style={{ fontSize: 11, color: "#374151" }}>Balance: {currentBalance} {tokenIn}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 32, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenInOpen(!tokenInOpen)}
                    disabled={isLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#ede9fe", border: "none", cursor: "pointer" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#ffffff" }}>{tokenIn[0]}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{tokenIn}</span>
                    <span style={{ fontSize: 9, color: "#4B5563" }}>▾</span>
                  </button>
                  {tokenInOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: "#ffffff", borderRadius: 12, padding: 6, minWidth: 140, boxShadow: "0 12px 30px rgba(124,58,237,0.15)" }}>
                      {TOKENS.map((t) => (
                        <button key={t} disabled={t === tokenIn}
                          onClick={() => { setTokenIn(t); setTokenOut(t === "USDC" ? "EURC" : "USDC"); setTokenInOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t === tokenIn ? "rgba(124,58,237,0.1)" : "transparent", border: "none", cursor: t === tokenIn ? "not-allowed" : "pointer", opacity: t === tokenIn ? 0.4 : 1 }}>
                          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#ffffff" }}>{t[0]}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setAmount(currentBalance)} disabled={isLoading}
                style={{ marginTop: 6, background: "none", border: "none", color: "#7c3aed", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                Max
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: -10, marginBottom: -10, position: "relative", zIndex: 1 }}>
              <button onClick={flipTokens} disabled={isLoading}
                style={{ width: 32, height: 32, borderRadius: 10, background: "#ffffff", border: "3px solid #ffffff", color: "#7c3aed", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ↓
              </button>
            </div>

            <div style={{ borderRadius: 16, background: "#f5f3ff", padding: "1rem 1.1rem" }}>
              <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 10 }}>You receive</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: "#111827", fontFamily: "ui-monospace, monospace" }}>{useLegacyRoute && legacyOut ? legacyOut : estimatedOut}</span>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenOutOpen(!tokenOutOpen)}
                    disabled={isLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#ede9fe", border: "none", cursor: "pointer" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#ffffff" }}>{tokenOut[0]}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{tokenOut}</span>
                    <span style={{ fontSize: 9, color: "#4B5563" }}>▾</span>
                  </button>
                  {tokenOutOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: "#ffffff", borderRadius: 12, padding: 6, minWidth: 140, boxShadow: "0 12px 30px rgba(124,58,237,0.15)" }}>
                      {TOKENS.map((t) => (
                        <button key={t} disabled={t === tokenOut}
                          onClick={() => { setTokenOut(t); setTokenIn(t === "USDC" ? "EURC" : "USDC"); setTokenOutOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t === tokenOut ? "rgba(124,58,237,0.1)" : "transparent", border: "none", cursor: t === tokenOut ? "not-allowed" : "pointer", opacity: t === tokenOut ? 0.4 : 1 }}>
                          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#ffffff" }}>{t[0]}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {rateStale && (
              <div style={{ background: "rgba(239,68,68,0.1)", borderRadius: 10, padding: "0.65rem 0.8rem" }}>
                <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>
                  Pool rate ({poolRate?.toFixed(4)}) differs from the live market rate ({marketRate?.toFixed(4)}) by more than 1%. This swap uses the pool's fixed rate.
                </p>
              </div>
            )}

            {amount && Number(amount) > 0 && Number(estimatedOut) > 0 && (
              <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>You receive</span>
                  <span style={{ color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{estimatedOut} {tokenOut}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Rate</span>
                  <span style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>1 {tokenIn} = {tokenIn === "USDC" ? poolRate?.toFixed(4) : (poolRate ? (1 / poolRate).toFixed(4) : "...")} {tokenOut}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Fee</span>
                  <span style={{ color: "#16A34A", fontWeight: 600 }}>0% — fixed-rate pool</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Minimum received</span>
                  <span style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{estimatedOut} {tokenOut}</span>
                </div>
              </div>
            )}

            {legacyOut && Number(amount) > 0 && (
              <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.85rem", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 2 }}>ROUTES ON FLOWFI</div>
                {[
                  { name: "Fixed-Rate Pool", out: estimatedOut, isLegacy: false },
                  { name: "Pool Factory V2", out: legacyOut, isLegacy: true },
                ].sort((a, b) => Number(b.out) - Number(a.out)).map((route, i) => (
                  <button key={route.name} onClick={() => setUseLegacyRoute(route.isLegacy)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "0.6rem 0.75rem", borderRadius: 10, border: "none", cursor: "pointer",
                      background: useLegacyRoute === route.isLegacy ? "#ffffff" : "transparent",
                      boxShadow: useLegacyRoute === route.isLegacy ? "0 1px 3px rgba(109,94,247,0.15)" : "none",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {i === 0 && <span style={{ fontSize: 9, fontWeight: 800, color: "#16A34A", background: "rgba(34,197,94,0.15)", padding: "2px 6px", borderRadius: 999 }}>BEST</span>}
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#111827" }}>{route.name}</span>
                    </div>
                    <span className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? "#16A34A" : "#4B5563" }}>{route.out} {tokenOut}</span>
                  </button>
                ))}
              </div>
            )}

            <SwapAdvisor tokenIn={tokenIn} tokenOut={tokenOut} amountIn={amount} amountOut={estimatedOut} />

            {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}

            {txHash && swapState === "done" && (
              <div style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 12, padding: "1rem" }}>
                <p style={{ color: "#7c3aed", fontWeight: 700, marginBottom: 6 }}>Swap successful!</p>
                <a href={"https://testnet.arcscan.app/tx/" + txHash} target="_blank" rel="noopener noreferrer" style={{ color: "#2563EB", fontSize: 13 }}>View on explorer</a>
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
                        background: done ? "#7c3aed" : active ? "rgba(168,85,247,0.25)" : "rgba(109,94,247,0.1)",
                        color: done ? "#ffffff" : active ? "#7C3AED" : "#374151",
                        border: active ? "1px solid #5B21B6" : "none",
                      }}>
                        {done ? "✓" : i + 1}
                      </div>
                      <span style={{ fontSize: 11, color: done ? "#7c3aed" : active ? "#7C3AED" : "#374151" }}>{label}</span>
                      {i < SWAP_STEPS.length - 1 && <span style={{ width: 16, height: 1, background: "rgba(109,94,247,0.15)" }} />}
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={swapState === "error" ? () => { setSwapState("idle"); setErrorMsg(null); } : doSwap}
              disabled={isLoading || swapState === "done"}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(109,94,247,0.4)", cursor: isLoading || swapState === "done" ? "not-allowed" : "pointer", opacity: isLoading || swapState === "done" ? 0.5 : 1, marginTop: 4 }}>
              {swapState === "idle" && "Swap"}
              {swapState === "approving" && "Approving..."}
              {swapState === "swapping" && "Swapping..."}
              {swapState === "done" && "Done!"}
              {swapState === "error" && "Try again"}
            </button>

            {swapState === "done" && (
              <button onClick={() => { setSwapState("idle"); setTxHash(null); }}
                style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#4B5563", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                New swap
              </button>
            )}
          </div>

          <div style={{ background: "#ffffff", borderRadius: 14, padding: "0.75rem 1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <p style={{ fontSize: 12, color: "#4B5563", margin: 0 }}>
              Pool rate: 1 USDC ≈ {poolRate?.toFixed(4) ?? "..."} EURC
              {marketRate && <span> · Live market: {marketRate.toFixed(4)}</span>}
            </p>
            <AdminRate provider={provider} address={address} />
          </div>

        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>DCA — RECURRING BUY</div>
            {!dcaPlan ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 11, color: "#6B7280", margin: 0, lineHeight: 1.5 }}>
                  Set an amount and interval. FlowFi will remind you to buy when it's due — you confirm each time.
                </p>
                <input type="number" min="1" value={dcaAmount} onChange={(e) => setDcaAmount(e.target.value)}
                  style={{ background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.5rem 0.7rem", fontSize: 13, color: "#111827", outline: "none" }} placeholder="USDC amount" />
                <div style={{ display: "flex", gap: 6 }}>
                  {(["daily", "weekly", "monthly"] as DCAFrequency[]).map((f) => (
                    <button key={f} onClick={() => setDcaFrequency(f)}
                      style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "none", background: dcaFrequency === f ? "#ede9fe" : "#f5f3ff", color: dcaFrequency === f ? "#5B21B6" : "#6B7280", fontSize: 10.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
                      {f}
                    </button>
                  ))}
                </div>
                <button onClick={() => { if (Number(dcaAmount) > 0) { setDCAPlan(Number(dcaAmount), dcaFrequency); setDcaPlanState(getDCAPlan()); } }}
                  style={{ width: "100%", padding: "0.55rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Set Up DCA
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12.5, color: "#111827" }}>
                  Buy <b>{dcaPlan.amount} USDC → EURC</b>, {dcaPlan.frequency}
                </div>
                <div style={{ fontSize: 11, color: isDCADue(dcaPlan) ? "#B45309" : "#6B7280" }}>
                  {isDCADue(dcaPlan) ? "Due now" : "Not due yet"}
                  {dcaPlan.lastExecuted && ` · last: ${new Date(dcaPlan.lastExecuted).toLocaleDateString()}`}
                </div>
                {isDCADue(dcaPlan) && (
                  <button onClick={executeDCANow} disabled={runningDCA}
                    style={{ width: "100%", padding: "0.55rem", borderRadius: 10, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 700, cursor: runningDCA ? "not-allowed" : "pointer", opacity: runningDCA ? 0.6 : 1 }}>
                    {runningDCA ? "Buying..." : "Run DCA Now"}
                  </button>
                )}
                <button onClick={() => { clearDCAPlan(); setDcaPlanState(null); }}
                  style={{ width: "100%", padding: "0.45rem", borderRadius: 10, border: "none", background: "transparent", color: "#6B7280", fontSize: 11, cursor: "pointer" }}>
                  Cancel plan
                </button>
              </div>
            )}
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>ROUTE DETAILS</div>
            {poolLiquidity ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#4B5563" }}>USDC in pool</span>
                  <span style={{ color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolLiquidity.usdc}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#4B5563" }}>EURC in pool</span>
                  <span style={{ color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolLiquidity.eurc}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#4B5563" }}>Pool rate</span>
                  <span style={{ color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolRate?.toFixed(4) ?? "..."}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#4B5563" }}>Live EUR/USD</span>
                  <span style={{ color: marketRate ? "#111827" : "#374151", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{marketRate?.toFixed(4) ?? "—"}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#374151" }}>Loading...</div>
            )}
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT ACTIVITY</div>
            {contractTxs.length === 0 && <div style={{ fontSize: 12, color: "#374151" }}>No recent activity yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {contractTxs.map((tx) => (
                <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.7rem", borderRadius: 10, background: "#f5f3ff", textDecoration: "none" }}>
                  <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>{tx.method}</span>
                  <span style={{ fontSize: 11, color: "#374151" }}>{tx.age}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, marginTop: "0.75rem", background: "#ffffff", borderRadius: 14, padding: "0.7rem 0", display: "flex", alignItems: "center", gap: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, paddingLeft: 14, flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7c3aed" }} />
          LIVE
        </span>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <div className="flowfi-ticker-track" style={{ display: "flex", gap: 32, whiteSpace: "nowrap", width: "max-content" }}>
            {[...tickerItems, ...tickerItems].map((tx, i) => (
              <span key={i} style={{ fontSize: 12, color: "#4B5563", fontFamily: "ui-monospace, monospace" }}>
                {tx.method} · {tx.age}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import SwapAdvisor from "./SwapAdvisor";
import ConfirmModal from "./ConfirmModal";
import { TokenIcon } from "./TokenIcon";
import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import { waitForSuccess } from "../txHelpers";
import { addPoints } from "../gamification";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo } from "../circleWalletHelpers";
import { getDCAPlan, setDCAPlan, clearDCAPlan, markDCAExecuted, isDCADue, type DCAPlan, type DCAFrequency } from "../dca";

const SWAP_STEPS = ["Approving", "Swapping", "Done"];
// Turns raw viem/wallet errors into a short, human message instead of dumping
// the full technical error (calldata, docs links, etc.) in front of the user.
function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: number; shortMessage?: string };
  if (err.code === 4001 || err.message?.includes("User rejected")) {
    return "You rejected the request in your wallet. No funds were moved — try again when you're ready.";
  }
  if (err.message?.includes("insufficient funds") || err.message?.includes("exceeds balance")) {
    return "Insufficient balance to cover this amount plus gas.";
  }
  return err.shortMessage ?? err.message ?? "Swap failed. Please try again.";
}

function swapStepIndex(state: string) {
  if (state === "approving") return 0;
  if (state === "swapping") return 1;
  if (state === "done") return 2;
  return -1;
}

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
// v6 change (mainnet-readiness — FlowFi does not provide swap liquidity
// itself): USDC/EURC swaps now route through FlowFi's own curated ArcPool
// instead of ArcSwap. ArcSwap required FlowFi (the contract owner) to be the
// sole liquidity provider and used an owner-set rate rather than one derived
// from real supply and demand — both directly contradicted the decision that
// FlowFi is an interface, not a liquidity provider. The pool is organically
// priced (constant-product, moves with real trading) and open to anyone to
// add liquidity to.
const POOL_ADDRESS = "0x3F0B83e551e272181e2A42144BB07E68d14bD497" as `0x${string}`; // ArcFactoryV2 v4c — USDC/EURC

const POOL_ABI = [
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
] as const;

// UnitFlow Finance — a real, independently-operated DEX on Arc Testnet
// (confirmed via Arc's own Builder Spotlight and UnitFlow's public docs).
// This factory address is publicly documented (used by the ACTFUN launchpad
// as its graduation venue) and is standard Uniswap V3-compatible
// infrastructure. UnitFlow's own official SwapRouter address is not yet
// confirmed, so this is read-only pool detection/display for now — NOT
// wired to execute trades. Never send a transaction to an unconfirmed
// router address.
const UNITFLOW_V3_FACTORY = "0xAb6A8AAb7d490007634ef59d424b5d89688a1971" as `0x${string}`;
const UNITFLOW_FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ name: "pool", type: "address" }] },
] as const;
const UNITFLOW_POOL_ABI = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint8" }, { name: "unlocked", type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint128" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;
const UNITFLOW_FEE_TIERS = [100, 500, 3000, 10000] as const;

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
  const [tokenInOpen, setTokenInOpen] = useState(false);
  const [tokenOutOpen, setTokenOutOpen] = useState(false);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [dcaPlan, setDcaPlanState] = useState<DCAPlan | null>(null);
  const [showDcaForm, setShowDcaForm] = useState(false);
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
  const [poolLiquidity, setPoolLiquidity] = useState<{ usdc: string; eurc: string } | null>(null);
  const [contractTxs, setContractTxs] = useState<ContractTx[]>([]);
  const [unitflowRoute, setUnitflowRoute] = useState<{ poolAddress: `0x${string}`; fee: number; rate: number } | null>(null);
  const [unitflowChecked, setUnitflowChecked] = useState(false);

  useEffect(() => {
    async function checkUnitflow() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        for (const fee of UNITFLOW_FEE_TIERS) {
          const poolAddr = await client.readContract({ address: UNITFLOW_V3_FACTORY, abi: UNITFLOW_FACTORY_ABI, functionName: "getPool", args: [USDC_ADDRESS, EURC_ADDRESS, fee] }).catch(() => null);
          if (!poolAddr || poolAddr === "0x0000000000000000000000000000000000000000") continue;
          const [liq, slot0, token0] = await Promise.all([
            client.readContract({ address: poolAddr, abi: UNITFLOW_POOL_ABI, functionName: "liquidity" }),
            client.readContract({ address: poolAddr, abi: UNITFLOW_POOL_ABI, functionName: "slot0" }),
            client.readContract({ address: poolAddr, abi: UNITFLOW_POOL_ABI, functionName: "token0" }),
          ]);
          if (liq === 0n) continue; // pool exists but nobody's added liquidity — same dust problem, skip
          // sqrtPriceX96 -> price of token1 in terms of token0 (both USDC/EURC are 6 decimals, so no decimal adjustment needed)
          const sqrtPriceX96 = slot0[0];
          const rawPrice = Number(sqrtPriceX96) ** 2 / 2 ** 192;
          const isUsdcToken0 = token0.toLowerCase() === USDC_ADDRESS.toLowerCase();
          const rate = isUsdcToken0 ? rawPrice : 1 / rawPrice; // EURC per USDC
          setUnitflowRoute({ poolAddress: poolAddr, fee, rate });
          setUnitflowChecked(true);
          return;
        }
        setUnitflowChecked(true);
      } catch {
        setUnitflowChecked(true);
      }
    }
    checkUnitflow();
  }, []);

  // The pool has no built-in awareness of the real market price — it only
  // knows the ratio of whatever's actually deposited in it. A small,
  // thinly-traded pool like this one has no arbitrage activity correcting
  // that ratio toward reality the way a deep pool (Uniswap etc.) would, so
  // this comparison is the only thing standing between a user and an
  // unknowingly bad trade. Purely informational — doesn't block the swap.
  const expectedPoolRate = marketRate ? 1 / marketRate : null;
  const priceDeviationPct = poolRate && expectedPoolRate ? Math.abs(poolRate - expectedPoolRate) / expectedPoolRate * 100 : null;
  const priceStale = priceDeviationPct !== null && priceDeviationPct > 1.5;

  // Below this, the pool physically cannot support a real swap — its price
  // is whatever dust ratio it happens to hold, not a live market rate, and
  // there's no "use the real rate" parameter for a constant-product AMM.
  // Real live pricing arrives via routing to actual deep liquidity (Uniswap/
  // LI.FI on Arc mainnet, expected after Sept 16) — until then, close this
  // pair off as a swap venue rather than execute against dust and surprise
  // the user with a terrible fill.
  const MIN_POOL_LIQUIDITY_USD = 50;
  const poolTooThin = poolLiquidity ? Number(poolLiquidity.usdc) + Number(poolLiquidity.eurc) < MIN_POOL_LIQUIDITY_USD : true;
  const fxEstimate = amount && expectedPoolRate && Number(amount) > 0
    ? (tokenIn === "USDC" ? Number(amount) * expectedPoolRate : Number(amount) / expectedPoolRate).toFixed(4)
    : "0.00";

  const activeBalances = useCircle && circleBalances ? circleBalances : { usdc: balances.usdc ?? "...", eurc: balances.eurc ?? "..." };
  const currentBalance = tokenIn === "USDC" ? activeBalances.usdc : activeBalances.eurc;

  const estimate = useCallback(async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setEstimatedOut("0.00"); return; }
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const amountIn = parseUnits(amount, 6);
      const out = await client.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "getAmountOut", args: [tokenIn === "USDC", amountIn] });
      setEstimatedOut(Number(formatUnits(out as bigint, 6)).toFixed(4));
    } catch {
      setEstimatedOut("0.00");
    }
  }, [amount, tokenIn]);

  useEffect(() => { estimate(); }, [estimate]);

  useEffect(() => {
    async function loadPoolRate() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        // A pool has no single stored "rate" the way ArcSwap did — quote a
        // reference amount to get an effective price. Purely informational
        // (no owner-set rate to validate for staleness anymore; the pool's
        // price is whatever real trading has made it).
        const out = await client.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "getAmountOut", args: [true, parseUnits("1", 6)] });
        setPoolRate(Number(formatUnits(out as bigint, 6)));

        const res = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=EUR");
        const data = await res.json();
        if (data.rates?.EUR) setMarketRate(data.rates.EUR);
      } catch {
        /* ignore */
      }
    }
    loadPoolRate();
  }, []);

  useEffect(() => {
    async function loadMarketInfo() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const [usdcBal, eurcBal] = await client.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "getReserves" });
        setPoolLiquidity({ usdc: Number(formatUnits(usdcBal, 6)).toFixed(2), eurc: Number(formatUnits(eurcBal, 6)).toFixed(2) });
      } catch {
        setPoolLiquidity(null);
      }

      try {
        const res = await fetch(`/api/arcscan-proxy?module=account&action=txlist&address=${POOL_ADDRESS}&limit=8`);
        const data = await res.json();
        const items: ContractTx[] = (data.result ?? []).slice(0, 8).map((tx: any) => ({
          hash: tx.hash,
          age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
          method: tx.methodId === "0x59542ca9" ? "Swap" : "Contract Call",
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
  const [showSwapConfirm, setShowSwapConfirm] = useState(false);

  function doSwap() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    setShowSwapConfirm(true);
  }

  async function executeSwap() {
    setShowSwapConfirm(false);
    setErrorMsg(null); setTxHash(null);
    const amountIn = parseUnits(amount, 6);
    const tokenAddress = tokenIn === "USDC" ? USDC_ADDRESS : EURC_ADDRESS;
    const minOut = (parseUnits(estimatedOut, 6) * 99n) / 100n; // 1% slippage tolerance
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    if (useCircle && circleWallet) {
      const arcWalletId = getWalletIdForChain(circleWallet, "ARC-TESTNET");
      if (!arcWalletId) { setErrorMsg("Circle Wallet has no Arc Testnet account."); setSwapState("error"); return; }
      try {
        setSwapState("approving");
        await circleContractCallAndWait({
          walletId: arcWalletId,
          contractAddress: tokenAddress,
          abiFunctionSignature: "approve(address,uint256)",
          abiParameters: [POOL_ADDRESS, amountIn.toString()],
        });

        setSwapState("swapping");
        const hash = await circleContractCallAndWait({
          walletId: arcWalletId,
          contractAddress: POOL_ADDRESS,
          abiFunctionSignature: "swap(bool,uint256,uint256,uint256)",
          abiParameters: [tokenIn === "USDC" ? "true" : "false", amountIn.toString(), minOut.toString(), deadline.toString()],
        });

        setTxHash(hash); setSwapState("done"); setAmount(""); setEstimatedOut("0.00");
        showToast("Swap completed", "success");
      addPoints(10);
      } catch (e: unknown) {
        setErrorMsg(friendlyError(e)); setSwapState("error");
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
        args: [POOL_ADDRESS, amountIn], account: address as `0x${string}`,
      });
      await waitForSuccess(publicClient, approveHash);

      setSwapState("swapping");
      const hash = await wc.writeContract({
        address: POOL_ADDRESS, abi: POOL_ABI, functionName: "swap",
        args: [tokenIn === "USDC", amountIn, minOut, deadline], account: address as `0x${string}`,
      });
      await waitForSuccess(publicClient, hash);

      setTxHash(hash); setSwapState("done"); setAmount(""); setEstimatedOut("0.00");
      showToast("Swap completed", "success");
      addPoints(10);
      onRefresh();
    } catch (e: unknown) {
      setErrorMsg(friendlyError(e)); setSwapState("error");
    }
  }

  const isLoading = swapState === "approving" || swapState === "swapping";

  const [showDCAConfirm, setShowDCAConfirm] = useState(false);

  function doDCANow() {
    if (!dcaPlan || runningDCA) return;
    setShowDCAConfirm(true);
  }

  async function executeDCANow() {
    setShowDCAConfirm(false);
    if (!dcaPlan || runningDCA) return;
    setRunningDCA(true);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const amountIn = parseUnits(String(dcaPlan.amount), 6);

      const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [POOL_ADDRESS, amountIn], account: address as `0x${string}` });
      await waitForSuccess(publicClient, approveHash);

      const freshQuote = await publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "getAmountOut", args: [true, amountIn] }) as bigint;
      const minOutForDCA = (freshQuote * 99n) / 100n; // 1% slippage tolerance
      const dcaDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const hash = await wc.writeContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "swap", args: [true, amountIn, minOutForDCA, dcaDeadline], account: address as `0x${string}` });
      await waitForSuccess(publicClient, hash);

      markDCAExecuted();
      setDcaPlanState(getDCAPlan());
      addPoints(10);
      showToast(`DCA buy complete: ${dcaPlan.amount} USDC → EURC`, "success");
      onRefresh();
    } catch (e: unknown) {
      showToast(friendlyError(e), "error");
    } finally {
      setRunningDCA(false);
    }
  }
  const tickerItems = contractTxs;

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

            <div style={{ borderRadius: 20, background: "#ffffff", border: "1px solid #EDE9FE", padding: "1rem 1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>You pay</span>
                <span style={{ fontSize: 12, color: "#6D5EF7", fontWeight: 600 }}>Balance: {currentBalance} {tokenIn}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <input type="number" min="0" step="0.01" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", boxShadow: "none", fontSize: 34, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenInOpen(!tokenInOpen)}
                    disabled={isLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px 7px 7px", borderRadius: 999, background: "#F5F3FF", border: "none", cursor: "pointer" }}>
                    <TokenIcon symbol={tokenIn} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{tokenIn}</span>
                    <span style={{ fontSize: 9, color: "#6B7280" }}>▾</span>
                  </button>
                  {tokenInOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: "#ffffff", borderRadius: 12, padding: 6, minWidth: 140, boxShadow: "0 12px 30px rgba(124,58,237,0.15)" }}>
                      {TOKENS.map((t) => (
                        <button key={t} disabled={t === tokenIn}
                          onClick={() => { setTokenIn(t); setTokenOut(t === "USDC" ? "EURC" : "USDC"); setTokenInOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t === tokenIn ? "rgba(124,58,237,0.1)" : "transparent", border: "none", cursor: t === tokenIn ? "not-allowed" : "pointer", opacity: t === tokenIn ? 0.4 : 1 }}>
                          <TokenIcon symbol={t} size={18} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>{amount && Number(amount) > 0 ? `$${Number(amount).toFixed(2)}` : "$0.00"}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} onClick={() => setAmount((Number(currentBalance) * pct / 100).toFixed(6))} disabled={isLoading}
                  style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 10, padding: "6px 14px", color: "#111827", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 4px rgba(0,0,0,0.08)" }}>
                  {pct === 100 ? "Max" : `${pct}%`}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: -14, marginBottom: -14, position: "relative", zIndex: 1 }}>
              <button onClick={flipTokens} disabled={isLoading}
                style={{ width: 34, height: 34, borderRadius: 10, background: "#ffffff", border: "1px solid #EDE9FE", color: "#6D5EF7", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(109,94,247,0.1)" }}>
                ↓
              </button>
            </div>

            <div style={{ borderRadius: 20, background: "#ffffff", border: "1px solid #EDE9FE", padding: "1rem 1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginBottom: 10 }}>You receive</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 34, fontWeight: 700, color: "#111827", fontFamily: "ui-monospace, monospace" }}>{poolTooThin ? fxEstimate : estimatedOut}</span>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setTokenOutOpen(!tokenOutOpen)}
                    disabled={isLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px 7px 7px", borderRadius: 999, background: "#F5F3FF", border: "none", cursor: "pointer" }}>
                    <TokenIcon symbol={tokenOut} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{tokenOut}</span>
                    <span style={{ fontSize: 9, color: "#6B7280" }}>▾</span>
                  </button>
                  {tokenOutOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: "#ffffff", borderRadius: 12, padding: 6, minWidth: 140, boxShadow: "0 12px 30px rgba(124,58,237,0.15)" }}>
                      {TOKENS.map((t) => (
                        <button key={t} disabled={t === tokenOut}
                          onClick={() => { setTokenOut(t); setTokenIn(t === "USDC" ? "EURC" : "USDC"); setTokenOutOpen(false); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t === tokenOut ? "rgba(124,58,237,0.1)" : "transparent", border: "none", cursor: t === tokenOut ? "not-allowed" : "pointer", opacity: t === tokenOut ? 0.4 : 1 }}>
                          <TokenIcon symbol={t} size={18} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>{Number(estimatedOut) > 0 ? `$${Number(estimatedOut).toFixed(2)}` : "$0.00"}</div>
            </div>

            {poolTooThin ? (
              <div style={{ background: "rgba(109,94,247,0.08)", border: "1px solid rgba(109,94,247,0.25)", borderRadius: 10, padding: "0.65rem 0.8rem" }}>
                <p style={{ fontSize: 12, color: "#5B21B6", margin: 0 }}>
                  FlowFi's own USDC/EURC pool doesn't hold enough liquidity to execute a real swap. The amount above is an FX estimate only, not an executable quote.
                  {unitflowChecked && !unitflowRoute && " Checked UnitFlow (a real Arc DEX) for a deeper route — none found with active liquidity yet."}
                  {unitflowRoute && ` A live UnitFlow pool was found (${unitflowRoute.rate.toFixed(4)} EURC/USDC) — execution routing there isn't wired up yet, this is read-only for now.`}
                </p>
              </div>
            ) : priceStale && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "0.65rem 0.8rem" }}>
                <p style={{ fontSize: 12, color: "#B45309", margin: 0 }}>
                  This pool's price ({poolRate?.toFixed(4)} EURC/USDC) is {priceDeviationPct?.toFixed(1)}% off the live market rate ({expectedPoolRate?.toFixed(4)}). This is a small, thinly-traded pool — its price can drift from the real market until someone trades or adds liquidity to correct it. Double-check before swapping a large amount.
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
                  <span style={{ color: "#16A34A", fontWeight: 600 }}>0.3% — pool fee, shared with liquidity providers</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Minimum received</span>
                  <span style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{(Number(estimatedOut) * 0.99).toFixed(4)} {tokenOut}</span>
                </div>
              </div>
            )}

            <SwapAdvisor tokenIn={tokenIn} tokenOut={tokenOut} amountIn={amount} amountOut={estimatedOut} />

            {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}

            {txHash && swapState === "done" && (
              <div style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 12, padding: "1rem" }}>
                <p style={{ color: "#6D5EF7", fontWeight: 700, marginBottom: 6 }}>Swap successful!</p>
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
                        background: done ? "#6D5EF7" : active ? "rgba(168,85,247,0.25)" : "rgba(109,94,247,0.1)",
                        color: done ? "#ffffff" : active ? "#6D5EF7" : "#374151",
                        border: active ? "1px solid #5B21B6" : "none",
                      }}>
                        {done ? "✓" : i + 1}
                      </div>
                      <span style={{ fontSize: 11, color: done ? "#6D5EF7" : active ? "#6D5EF7" : "#374151" }}>{label}</span>
                      {i < SWAP_STEPS.length - 1 && <span style={{ width: 16, height: 1, background: "rgba(109,94,247,0.15)" }} />}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#f5f3ff", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1rem" }}>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Rate</div>
                <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>1 USDC = {poolRate?.toFixed(4) ?? "..."} EURC</div>
              </div>
              <div style={{ padding: "0.75rem 1rem", borderLeft: "1px solid #EDE9FE" }}>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Fee</div>
                <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>0.3%</div>
              </div>
            </div>
            <button onClick={swapState === "error" ? () => { setSwapState("idle"); setErrorMsg(null); } : doSwap}
              disabled={isLoading || swapState === "done" || poolTooThin}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#6D5EF7", color: "#ffffff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(109,94,247,0.4)", cursor: isLoading || swapState === "done" || poolTooThin ? "not-allowed" : "pointer", opacity: isLoading || swapState === "done" || poolTooThin ? 0.5 : 1, marginTop: 4 }}>
              {poolTooThin && swapState === "idle" && "No live venue yet"}
              {!poolTooThin && swapState === "idle" && "Swap"}
              {swapState === "approving" && "Approving..."}
              {swapState === "swapping" && "Swapping..."}
              {swapState === "done" && "Done!"}
              {swapState === "error" && "Try again"}
            </button>

            {showSwapConfirm && (
              <ConfirmModal
                title="Confirm Swap"
                rows={[
                  { label: "You pay", value: `${amount} ${tokenIn}`, highlight: true },
                  { label: "You receive (est.)", value: `${estimatedOut} ${tokenIn === "USDC" ? "EURC" : "USDC"}` },
                ]}
                confirmLabel="Confirm Swap"
                onConfirm={executeSwap}
                onCancel={() => setShowSwapConfirm(false)}
              />
            )}

            {showDCAConfirm && dcaPlan && (
              <ConfirmModal
                title="Confirm DCA Buy"
                rows={[
                  { label: "Amount", value: `${dcaPlan.amount} USDC`, highlight: true },
                  { label: "Buying", value: "EURC" },
                ]}
                confirmLabel="Confirm Buy"
                onConfirm={executeDCANow}
                onCancel={() => setShowDCAConfirm(false)}
              />
            )}

            {swapState === "done" && (
              <button onClick={() => { setSwapState("idle"); setTxHash(null); }}
                style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#4B5563", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                New swap
              </button>
            )}
          </div>

        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            {!dcaPlan && !showDcaForm ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#4B5563" }}>No recurring buys set up</span>
                <button onClick={() => setShowDcaForm(true)} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Set up →</button>
              </div>
            ) : (
            <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px" }}>DCA — RECURRING BUY</div>
              {!dcaPlan && (
                <button onClick={() => setShowDcaForm(false)} style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: 11, cursor: "pointer", padding: 0 }}>Collapse</button>
              )}
            </div>
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
                  <button onClick={doDCANow} disabled={runningDCA}
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
            </>
            )}
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>ROUTE DETAILS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#4B5563" }}>USDC in pool</span>
                <span style={{ color: poolLiquidity ? "#111827" : "#9CA3AF", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolLiquidity?.usdc ?? "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#4B5563" }}>EURC in pool</span>
                <span style={{ color: poolLiquidity ? "#111827" : "#9CA3AF", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolLiquidity?.eurc ?? "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#4B5563" }}>Pool rate</span>
                <span style={{ color: poolRate ? "#111827" : "#9CA3AF", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{poolRate?.toFixed(4) ?? "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#4B5563" }}>Live EUR/USD</span>
                <span style={{ color: marketRate ? "#111827" : "#9CA3AF", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{marketRate?.toFixed(4) ?? "—"}</span>
              </div>
            </div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT ACTIVITY</div>
            {contractTxs.length === 0 && <div style={{ fontSize: 12, color: "#374151" }}>No recent activity yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {contractTxs.map((tx) => (
                <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.7rem", borderRadius: 10, background: "#f5f3ff", textDecoration: "none" }}>
                  <span style={{ fontSize: 11, color: "#6D5EF7", fontWeight: 600 }}>{tx.method}</span>
                  <span style={{ fontSize: 11, color: "#374151" }}>{tx.age}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tickerItems.length > 0 && (
      <div style={{ position: "relative", zIndex: 1, marginTop: "0.75rem", background: "#ffffff", borderRadius: 14, padding: "0.7rem 0", display: "flex", alignItems: "center", gap: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <span style={{ fontSize: 11, color: "#6D5EF7", fontWeight: 700, paddingLeft: 14, flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6D5EF7" }} />
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
      )}
    </div>
  );
}

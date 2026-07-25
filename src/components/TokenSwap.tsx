import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";

const TOKEN_FACTORY = "0x481E8919f79A4DA6446EA78cEa70037acB9c85A1" as `0x${string}`;
const POOL_FACTORY_V2 = "0xE610D2f76547c2a3073e1273E7BFA80d395eCDf8" as `0x${string}`;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;

const TOKEN_FACTORY_ABI = [
  { type: "function", name: "allTokensLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allTokens", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

const TOKEN_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

const POOL_FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_ABI = [
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
  usdcBalance: string | null;
  onRefresh: () => void;
}

interface LaunchedToken {
  address: string;
  name: string;
  symbol: string;
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

export default function TokenSwap({ provider, address, usdcBalance, onRefresh }: Props) {
  const [tokens, setTokens] = useState<LaunchedToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [selectedToken, setSelectedToken] = useState<LaunchedToken | null>(null);
  const [poolAddress, setPoolAddress] = useState<string | null>(null);
  const [direction, setDirection] = useState<"usdcToToken" | "tokenToUsdc">("usdcToToken");
  const [amount, setAmount] = useState("");
  const [estimatedOut, setEstimatedOut] = useState("0.00");
  const [tokenBalance, setTokenBalance] = useState<string>("...");
  const [state, setState] = useState<"idle" | "approving" | "swapping" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noPool, setNoPool] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const count = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokensLength" });
      const loaded: LaunchedToken[] = [];
      const total = Number(count);
      const start = total > 20 ? total - 20 : 0;
      for (let i = total - 1; i >= start; i--) {
        const tokenAddr = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokens", args: [BigInt(i)] });
        const [tName, tSymbol] = await Promise.all([
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "name" }),
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "symbol" }),
        ]);
        loaded.push({ address: tokenAddr, name: tName, symbol: tSymbol });
        await new Promise(r => setTimeout(r, 50));
      }
      setTokens(loaded);
      if (loaded.length > 0 && !selectedToken) setSelectedToken(loaded[0]);
    } catch {
      setTokens([]);
    } finally {
      setLoadingTokens(false);
    }
  }, [selectedToken]);

  useEffect(() => { loadTokens(); }, []);

  useEffect(() => {
    async function loadPool() {
      if (!selectedToken) return;
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const pool = await client.readContract({ address: POOL_FACTORY_V2, abi: POOL_FACTORY_ABI, functionName: "getPool", args: [selectedToken.address as `0x${string}`, USDC_ADDRESS] });
        if (pool === "0x0000000000000000000000000000000000000000") {
          setPoolAddress(null);
          setNoPool(true);
        } else {
          setPoolAddress(pool);
          setNoPool(false);
        }

        const bal = await client.readContract({ address: selectedToken.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
        setTokenBalance(Number(formatUnits(bal, 18)).toFixed(2));
      } catch {
        setPoolAddress(null);
        setNoPool(true);
      }
    }
    loadPool();
  }, [selectedToken, address]);

  const estimate = useCallback(async () => {
    if (!poolAddress || !amount || isNaN(Number(amount)) || Number(amount) <= 0) { setEstimatedOut("0.00"); return; }
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const tokenAIsSelected = await client.readContract({ address: poolAddress as `0x${string}`, abi: POOL_ABI, functionName: "tokenA" });
      const selectedIsA = tokenAIsSelected.toLowerCase() === selectedToken?.address.toLowerCase();

      // direction usdcToToken: input is USDC (6 decimals), output is token (18 decimals)
      const inDecimals = direction === "usdcToToken" ? 6 : 18;
      const outDecimals = direction === "usdcToToken" ? 18 : 6;
      const amountIn = parseUnits(amount, inDecimals);

      // aToB depends on whether USDC is tokenA or tokenB in this pool
      const usdcIsA = !selectedIsA;
      const aToB = direction === "usdcToToken" ? usdcIsA : !usdcIsA;

      const out = await client.readContract({ address: poolAddress as `0x${string}`, abi: POOL_ABI, functionName: "getAmountOut", args: [aToB, amountIn] });
      setEstimatedOut(Number(formatUnits(out, outDecimals)).toFixed(4));
    } catch {
      setEstimatedOut("0.00");
    }
  }, [poolAddress, amount, direction, selectedToken]);

  useEffect(() => { estimate(); }, [estimate]);

  function flipDirection() {
    setDirection(direction === "usdcToToken" ? "tokenToUsdc" : "usdcToToken");
    setAmount("");
    setEstimatedOut("0.00");
  }

  async function doSwap() {
    if (!poolAddress || !selectedToken) { setErrorMsg("No pool available for this token."); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      const tokenAIsSelected = await publicClient.readContract({ address: poolAddress as `0x${string}`, abi: POOL_ABI, functionName: "tokenA" });
      const selectedIsA = tokenAIsSelected.toLowerCase() === selectedToken.address.toLowerCase();
      const usdcIsA = !selectedIsA;
      const aToB = direction === "usdcToToken" ? usdcIsA : !usdcIsA;

      const inDecimals = direction === "usdcToToken" ? 6 : 18;
      const amountIn = parseUnits(amount, inDecimals);
      const inputToken = direction === "usdcToToken" ? USDC_ADDRESS : selectedToken.address as `0x${string}`;

      setState("approving");
      const a1 = await wc.writeContract({ address: inputToken, abi: erc20Abi, functionName: "approve", args: [poolAddress as `0x${string}`, amountIn], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      setState("swapping");
      const minOut = 0n; // demo simplicity, no slippage protection UI yet
      const hash = await wc.writeContract({ address: poolAddress as `0x${string}`, abi: POOL_ABI, functionName: "swap", args: [aToB, amountIn, minOut], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("done"); setAmount(""); setEstimatedOut("0.00");
      showToast("Swap completed", "success");
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Swap failed."); setState("error");
    }
  }

  const isLoading = state === "approving" || state === "swapping";
  const fromLabel = direction === "usdcToToken" ? "USDC" : selectedToken?.symbol ?? "";
  const toLabel = direction === "usdcToToken" ? selectedToken?.symbol ?? "" : "USDC";
  const fromBalance = direction === "usdcToToken" ? (usdcBalance ?? "...") : tokenBalance;

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Token</label>
        {loadingTokens ? (
          <div style={{ fontSize: 12, color: "#334155" }}>Loading launched tokens...</div>
        ) : tokens.length === 0 ? (
          <div style={{ fontSize: 12, color: "#334155" }}>No tokens launched yet.</div>
        ) : (
          <select value={selectedToken?.address ?? ""} onChange={(e) => setSelectedToken(tokens.find(t => t.address === e.target.value) ?? null)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.65rem", color: "#f1f5f9", fontSize: 13 }}>
            {tokens.map(t => <option key={t.address} value={t.address} style={{ color: "#000" }}>{t.name} ({t.symbol})</option>)}
          </select>
        )}
      </div>

      {noPool && selectedToken && (
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: "0.65rem 0.8rem" }}>
          <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>No USDC pool exists for {selectedToken.symbol} yet. The creator needs to add liquidity first.</p>
        </div>
      )}

      {poolAddress && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>From</label>
              <span style={{ fontSize: 11, color: "#475569" }}>Balance: {fromBalance} {fromLabel}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
              <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>{fromLabel}</span>
            </div>
          </div>

          <button onClick={flipDirection} disabled={isLoading}
            style={{ alignSelf: "center", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, padding: "6px 16px", color: "#a78bfa", fontSize: 16, cursor: "pointer" }}>
            ⇅
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>To (estimated)</label>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>{estimatedOut}</span>
              <span style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>{toLabel}</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "0.65rem 0.9rem", fontSize: 11, color: "#64748b" }}>
            0.3% pool fee applies. Prices from a live AMM curve — larger trades move the price more.
          </div>

          {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

          <button onClick={state === "error" ? () => { setState("idle"); setErrorMsg(null); } : doSwap}
            disabled={isLoading || state === "done"}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #7c3aed, #8b5cf6)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
            {state === "idle" && "Swap"}
            {state === "approving" && "Approving..."}
            {state === "swapping" && "Swapping..."}
            {state === "done" && "Done! Swap Again"}
            {state === "error" && "Try Again"}
          </button>
        </>
      )}
    </div>
  );
}

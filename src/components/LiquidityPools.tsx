import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const AMM_CONTRACT = "0x01ddb4902e2F22f6124Ec685540C424d1BB75E0C" as `0x${string}`;

const AMM_ABI = [
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "usdcAmount", type: "uint256" }, { name: "eurcAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "removeLiquidity", stateMutability: "nonpayable", inputs: [{ name: "shareAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getShareValue", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ name: "usdcAmount", type: "uint256" }, { name: "eurcAmount", type: "uint256" }] },
  { type: "function", name: "shares", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onRefresh: () => void;
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

export default function LiquidityPools({ provider, address, balances, onRefresh }: Props) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [eurcAmount, setEurcAmount] = useState("");
  const [removePct, setRemovePct] = useState(50);
  const [state, setState] = useState<"idle" | "approving1" | "approving2" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reserves, setReserves] = useState<{ usdc: string; eurc: string } | null>(null);
  const [myShare, setMyShare] = useState<{ usdc: string; eurc: string; pct: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPoolData = useCallback(async () => {
    setLoading(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [resUsdc, resEurc] = await client.readContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "getReserves" });
      setReserves({ usdc: Number(formatUnits(resUsdc, 6)).toFixed(2), eurc: Number(formatUnits(resEurc, 6)).toFixed(2) });

      const [myUsdc, myEurc] = await client.readContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "getShareValue", args: [address as `0x${string}`] });
      const myShares = await client.readContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "shares", args: [address as `0x${string}`] });
      const total = await client.readContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "totalShares" });
      const pct = total > 0n ? (Number(myShares) / Number(total)) * 100 : 0;
      setMyShare({ usdc: Number(formatUnits(myUsdc, 6)).toFixed(4), eurc: Number(formatUnits(myEurc, 6)).toFixed(4), pct: pct.toFixed(3) });
    } catch {
      setReserves(null);
      setMyShare(null);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { loadPoolData(); }, [loadPoolData]);

  const poolRatio = reserves ? Number(reserves.eurc) / Number(reserves.usdc) : null;

  function onUsdcChange(v: string) {
    setUsdcAmount(v);
    if (poolRatio && v) setEurcAmount((Number(v) * poolRatio).toFixed(4));
  }
  function onEurcChange(v: string) {
    setEurcAmount(v);
    if (poolRatio && v) setUsdcAmount((Number(v) / poolRatio).toFixed(4));
  }

  async function doAddLiquidity() {
    if (!usdcAmount || !eurcAmount || Number(usdcAmount) <= 0 || Number(eurcAmount) <= 0) {
      setErrorMsg("Enter valid amounts for both tokens."); return;
    }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const usdcUnits = parseUnits(usdcAmount, 6);
      const eurcUnits = parseUnits(eurcAmount, 6);

      setState("approving1");
      const a1 = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [AMM_CONTRACT, usdcUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      setState("approving2");
      const a2 = await wc.writeContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [AMM_CONTRACT, eurcUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a2 });

      setState("processing");
      const hash = await wc.writeContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "addLiquidity", args: [usdcUnits, eurcUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setUsdcAmount(""); setEurcAmount("");
      await loadPoolData();
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to add liquidity."); setState("error");
    }
  }

  async function doRemoveLiquidity() {
    if (!myShare) return;
    setErrorMsg(null); setState("processing");
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const myShares = await client.readContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "shares", args: [address as `0x${string}`] });
      const shareToRemove = (myShares * BigInt(removePct)) / 100n;
      if (shareToRemove === 0n) throw new Error("Nothing to remove.");

      const hash = await wc.writeContract({ address: AMM_CONTRACT, abi: AMM_ABI, functionName: "removeLiquidity", args: [shareToRemove], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle");
      await loadPoolData();
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to remove liquidity."); setState("error");
    }
  }

  const isLoading = state === "approving1" || state === "approving2" || state === "processing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 460 }}>
      <div style={{ background: "rgba(79,70,229,0.05)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#a5b4fc", margin: 0 }}>
          Community AMM pool — add USDC/EURC liquidity and earn a share of the 0.3% swap fee. Anyone can participate.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 6 }}>POOL RESERVES</div>
          {loading ? <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div> : reserves ? (
            <>
              <div style={{ fontSize: 13, color: "#e2e8f0" }}>{reserves.usdc} USDC</div>
              <div style={{ fontSize: 13, color: "#e2e8f0" }}>{reserves.eurc} EURC</div>
            </>
          ) : <div style={{ fontSize: 12, color: "#334155" }}>—</div>}
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 6 }}>YOUR SHARE</div>
          {myShare ? (
            <>
              <div style={{ fontSize: 13, color: "#a5b4fc", fontWeight: 700 }}>{myShare.pct}% of pool</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{myShare.usdc} USDC + {myShare.eurc} EURC</div>
            </>
          ) : <div style={{ fontSize: 12, color: "#334155" }}>No position</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setMode("add")}
          style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: mode === "add" ? "2px solid #4f46e5" : "1px solid rgba(255,255,255,0.08)", background: mode === "add" ? "rgba(79,70,229,0.15)" : "rgba(255,255,255,0.03)", color: mode === "add" ? "#a5b4fc" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Add Liquidity
        </button>
        <button onClick={() => setMode("remove")}
          style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: mode === "remove" ? "2px solid #4f46e5" : "1px solid rgba(255,255,255,0.08)", background: mode === "remove" ? "rgba(79,70,229,0.15)" : "rgba(255,255,255,0.03)", color: mode === "remove" ? "#a5b4fc" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Remove Liquidity
        </button>
      </div>

      {mode === "add" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>USDC</label>
              <span style={{ fontSize: 11, color: "#475569" }}>Balance: {balances.usdc ?? "..."}</span>
            </div>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={usdcAmount} onChange={(e) => onUsdcChange(e.target.value)} disabled={isLoading}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 16, color: "#f1f5f9", fontWeight: 600, outline: "none" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>EURC</label>
              <span style={{ fontSize: 11, color: "#475569" }}>Balance: {balances.eurc ?? "..."}</span>
            </div>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={eurcAmount} onChange={(e) => onEurcChange(e.target.value)} disabled={isLoading}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 16, color: "#f1f5f9", fontWeight: 600, outline: "none" }} />
          </div>
          {poolRatio && <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>Pool ratio: 1 USDC ≈ {poolRatio.toFixed(4)} EURC</p>}

          {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

          <button onClick={doAddLiquidity} disabled={isLoading}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
            {state === "approving1" && "Approving USDC..."}
            {state === "approving2" && "Approving EURC..."}
            {state === "processing" && "Adding Liquidity..."}
            {(state === "idle" || state === "error") && "Add Liquidity"}
          </button>
        </div>
      )}

      {mode === "remove" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {myShare && Number(myShare.pct) > 0 ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount to remove</label>
                  <span style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700 }}>{removePct}%</span>
                </div>
                <input type="range" min="1" max="100" value={removePct} onChange={(e) => setRemovePct(Number(e.target.value))} disabled={isLoading} />
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "0.8rem 0.9rem" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>You will receive approximately</div>
                <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{(Number(myShare.usdc) * removePct / 100).toFixed(4)} USDC</div>
                <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{(Number(myShare.eurc) * removePct / 100).toFixed(4)} EURC</div>
              </div>
              {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}
              <button onClick={doRemoveLiquidity} disabled={isLoading}
                style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #dc2626, #ef4444)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "processing" ? "Removing..." : "Remove Liquidity"}
              </button>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#64748b", textAlign: "center", margin: 0 }}>You don't have any liquidity in this pool yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
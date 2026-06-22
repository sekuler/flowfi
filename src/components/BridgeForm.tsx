import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { sepolia } from "viem/chains";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { USDC_ADDRESS_SEPOLIA } from "../chains";
import BridgeStatus from "./BridgeStatus";

interface Step {
  name: string;
  state: "pending" | "success" | "error";
  explorerUrl?: string;
  txHash?: string;
}

interface Props {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
}

const kit = new AppKit();

export default function BridgeForm({ provider, address, walletName }: Props) {
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [bridgeState, setBridgeState] = useState<"idle" | "bridging" | "done" | "error">("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    try {
      const client = createPublicClient({ chain: sepolia, transport: http() });
      const raw = await client.readContract({ address: USDC_ADDRESS_SEPOLIA, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
      setUsdcBalance(Number(formatUnits(raw, 6)).toFixed(2));
    } catch { setUsdcBalance("Failed to load"); }
  }, [address]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  function handleEvent(payload: unknown) {
    const p = payload as { values?: { name?: string; state?: string; explorerUrl?: string; txHash?: string } };
    if (!p?.values?.name) return;
    const stepName = p.values.name;
    const stepState = (p.values.state ?? "pending") as Step["state"];
    const explorerUrl = p.values.explorerUrl;
    const txHash = p.values.txHash;
    setSteps((prev) => {
      const existing = prev.findIndex((s) => s.name === stepName);
      if (existing >= 0) { const updated = [...prev]; updated[existing] = { name: stepName, state: stepState, explorerUrl, txHash }; return updated; }
      return [...prev, { name: stepName, state: stepState, explorerUrl, txHash }];
    });
  }

  async function startBridge() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    if (Number(amount) > Number(usdcBalance ?? 0)) { setErrorMsg("Cannot exceed your balance."); return; }
    setErrorMsg(null); setBridgeState("bridging"); setSteps([]);
    kit.on("*", handleEvent);
    try {
      const adapter = await createViemAdapterFromProvider({ provider });
      let result = await kit.bridge({ from: { adapter, chain: "Ethereum_Sepolia" }, to: { adapter, chain: "Arc_Testnet" }, amount: Number(amount).toFixed(2) });
      if (result.state === "error") { result = await kit.retryBridge(result, { from: adapter, to: adapter }); }
      if (result.state === "error") throw new Error("Bridge failed. Please try again.");
      setBridgeState("done"); await loadBalance();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Unexpected error."); setBridgeState("error");
    } finally { kit.off("*", handleEvent); }
  }

  const shortAddr = address.slice(0, 6) + "..." + address.slice(-4);
  const isLoading = bridgeState === "bridging";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: 460 }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", backdropFilter: "blur(10px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Connected wallet</div>
            <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>{"Wallet: " + walletName + " - " + shortAddr}</div>
          </div>
          <div style={{ background: "rgba(59,130,246,0.15)", color: "#93c5fd", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
            Ethereum Sepolia
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.875rem 1rem" }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Sepolia USDC Balance</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9" }}>
            {usdcBalance === null ? "Loading..." : "$" + usdcBalance + " USDC"}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "0.75rem 1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 220 }}>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Ethereum Sepolia</div>
            <div style={{ color: "#3b82f6", fontSize: 20 }}>{"↓"}</div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Arc Testnet</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount to Bridge</label>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <input type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading || bridgeState === "done"}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
            <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>USDC</span>
          </div>
          {usdcBalance && usdcBalance !== "Failed to load" && (
            <button onClick={() => setAmount(usdcBalance)} disabled={isLoading}
              style={{ alignSelf: "flex-end", background: "none", border: "none", color: "#60a5fa", fontSize: 12, cursor: "pointer", padding: 0 }}>
              Use Max
            </button>
          )}
        </div>
        {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}
        <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "0.6rem 0.875rem" }}>
          <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            {"Gas on Sepolia requires ETH. Gas on Arc requires native USDC. "}
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>Get from Faucet</a>
          </p>
        </div>
        <button onClick={startBridge} disabled={isLoading || bridgeState === "done"}
          style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading || bridgeState === "done" ? "not-allowed" : "pointer", opacity: isLoading || bridgeState === "done" ? 0.6 : 1, boxShadow: "0 0 24px rgba(59,130,246,0.3)" }}>
          {bridgeState === "idle" && "Bridge"}
          {bridgeState === "bridging" && "Bridging..."}
          {bridgeState === "done" && "Done!"}
          {bridgeState === "error" && "Try Again"}
        </button>
        {bridgeState === "error" && (
          <button onClick={() => { setBridgeState("idle"); setSteps([]); setErrorMsg(null); }}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Reset
          </button>
        )}
      </div>
      {steps.length > 0 && <BridgeStatus steps={steps} isComplete={bridgeState === "done"} isFailed={bridgeState === "error"} />}
    </div>
  );
}

import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";

const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;

const SWAP_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "usdcToEurcRate", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "setRate", stateMutability: "nonpayable", inputs: [{ name: "newRate", type: "uint256" }], outputs: [] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
}

async function check() {
  try {
    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    const owner = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "owner" });
    console.log("Contract owner:", owner, "My address:", address);
    setIsOwner((owner as string).toLowerCase() === address.toLowerCase());
    const rate = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "usdcToEurcRate" });
    setCurrentRate((Number(rate) / 1e6).toFixed(4));
  } catch (e) { console.log("AdminRate error:", e); }
}

export default function AdminRate({ provider, address }: Props) {
  const [isOwner, setIsOwner] = useState(false);
  const [currentRate, setCurrentRate] = useState<string | null>(null);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "fetching" | "updating" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const owner = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "owner" });
        setIsOwner((owner as string).toLowerCase() === address.toLowerCase());
        const rate = await client.readContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "usdcToEurcRate" });
        setCurrentRate((Number(rate) / 1e6).toFixed(4));
      } catch (e) { console.log("AdminRate error:", e); }
    }
    check();
  }, [address]);

  async function fetchLiveRate() {
    setState("fetching"); setError(null);
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
      const data = await res.json();
      const rate = data.rates?.EUR;
      if (!rate) throw new Error("Rate not found in response.");
      setLiveRate(rate);
      setState("idle");
    } catch {
      setError("Could not fetch live rate.");
      setState("error");
    }
  }

  async function updateOnChain() {
    if (!liveRate) return;
    setState("updating"); setError(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const newRateScaled = BigInt(Math.round(liveRate * 1e6));
      const hash = await wc.writeContract({
        address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "setRate",
        args: [newRateScaled], account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setCurrentRate(liveRate.toFixed(4));
      setState("done");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Update failed.");
      setState("error");
    }
  }

  if (!isOwner) return null;

  return (
    <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, padding: "1rem", marginTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700 }}>ADMIN: Live FX Rate</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>Current: {currentRate ?? "..."}</span>
      </div>

      {liveRate && (
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
          Live rate: 1 USD = {liveRate.toFixed(4)} EUR
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: "#fca5a5", marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={fetchLiveRate} disabled={state === "fetching" || state === "updating"}
          style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#fbbf24", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          {state === "fetching" ? "Fetching..." : "Fetch Live Rate"}
        </button>
        {liveRate && (
          <button onClick={updateOnChain} disabled={state === "updating"}
            style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {state === "updating" ? "Updating..." : "Update On-Chain"}
          </button>
        )}
      </div>

      {state === "done" && <div style={{ fontSize: 11, color: "#6ee7b7", marginTop: 6 }}>Rate updated successfully!</div>}
    </div>
  );
}

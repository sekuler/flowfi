import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { showToast } from "../toast";

const BASE_L1_BRIDGE = "0xc0d598bee79a93a442556c451204c71059ffa0d5" as `0x${string}`;
const ARBITRUM_INBOX = "0xaAe29B0366299461418F5324a79Afc425BE5ae21" as `0x${string}`;
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

const ARBITRUM_INBOX_ABI = [
  { type: "function", name: "depositEth", stateMutability: "payable", inputs: [{ name: "destAddr", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
}

type Destination = "Base Sepolia" | "Arbitrum Sepolia";

async function switchToSepolia(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID_HEX, chainName: "Ethereum Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.sepolia.org"], blockExplorerUrls: ["https://sepolia.etherscan.io"] }] });
    } else throw e;
  }
}

export default function EthBridge({ provider, address }: Props) {
  const [destination, setDestination] = useState<Destination>("Base Sepolia");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function doDeposit() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null); setTxHash(null);
    try {
      await switchToSepolia(provider);
      const publicClient = createPublicClient({ chain: sepolia, transport: http() });
      const wc = createWalletClient({ chain: sepolia, transport: custom(provider) });
      const value = parseEther(amount);

      setState("processing");
      let hash: `0x${string}`;
      if (destination === "Base Sepolia") {
        // OP Stack bridges: sending ETH directly to the bridge deposits it to msg.sender on L2
        hash = await wc.sendTransaction({ to: BASE_L1_BRIDGE, value, account: address as `0x${string}` });
      } else {
        hash = await wc.writeContract({ address: ARBITRUM_INBOX, abi: ARBITRUM_INBOX_ABI, functionName: "depositEth", args: [address as `0x${string}`], value, account: address as `0x${string}`, gas: 300000n });
      }
      await publicClient.waitForTransactionReceipt({ hash });

      setTxHash(hash);
      setState("done");
      showToast("ETH deposit submitted", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Deposit failed."); setState("error");
    }
  }

  const isLoading = state === "processing";

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: "0.6rem 0.8rem" }}>
        <p style={{ fontSize: 12, color: "#fcd34d", margin: 0 }}>
          Native ETH deposit via each chain's official L1→L2 bridge — Ethereum Sepolia only. Takes several minutes to appear on the destination.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Deposit ETH to</label>
        <div style={{ display: "flex", gap: 8 }}>
          {(["Base Sepolia", "Arbitrum Sepolia"] as Destination[]).map((d) => (
            <button key={d} onClick={() => setDestination(d)} disabled={isLoading}
              style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: destination === d ? "2px solid #f59e0b" : "1px solid rgba(255,255,255,0.08)", background: destination === d ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.03)", color: destination === d ? "#fbbf24" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount</label>
        <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <input type="number" min="0.001" step="0.001" placeholder="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
          <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>ETH</span>
        </div>
      </div>

      {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

      {txHash && state === "done" && (
        <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "1rem" }}>
          <p style={{ color: "#6ee7b7", fontWeight: 600, marginBottom: 6 }}>Deposit submitted!</p>
          <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on Sepolia Etherscan ↗</a>
          <p style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>It may take a few minutes to appear on {destination}.</p>
        </div>
      )}

      <button onClick={state === "error" ? () => { setState("idle"); setErrorMsg(null); } : doDeposit}
        disabled={isLoading || state === "done"}
        style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #d97706, #f59e0b)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading || state === "done" ? "not-allowed" : "pointer", opacity: isLoading || state === "done" ? 0.6 : 1 }}>
        {state === "idle" && `Deposit to ${destination}`}
        {isLoading && "Depositing..."}
        {state === "done" && "Done!"}
        {state === "error" && "Try Again"}
      </button>

      {state === "done" && (
        <button onClick={() => { setState("idle"); setTxHash(null); setAmount(""); }}
          style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          New Deposit
        </button>
      )}
    </div>
  );
}

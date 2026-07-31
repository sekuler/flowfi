import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { showToast } from "../toast";
import { Zap, ShieldAlert, ExternalLink } from "lucide-react";

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

const DEST_META: Record<Destination, { dot: string }> = {
  "Base Sepolia": { dot: "#0052ff" },
  "Arbitrum Sepolia": { dot: "#28a0f0" },
};

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
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "1.25rem", alignItems: "start" }}>
      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.1)", borderRadius: 12, padding: "0.65rem 0.85rem" }}>
          <ShieldAlert size={16} color="#B45309" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: "#B45309", margin: 0 }}>
            Native ETH deposit via each chain's official L1→L2 bridge — Ethereum Sepolia only.
          </p>
        </div>

        <div>
          <label style={{ fontSize: 13, color: "#4B5563", fontWeight: 600 }}>Deposit ETH to</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {(["Base Sepolia", "Arbitrum Sepolia"] as Destination[]).map((d) => (
              <button key={d} onClick={() => setDestination(d)} disabled={isLoading}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0.75rem", borderRadius: 14, border: destination === d ? "1.5px solid #f59e0b" : "1px solid #D4C9FA", background: destination === d ? "rgba(245,158,11,0.1)" : "#ffffff", color: destination === d ? "#B45309" : "#4B5563", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: DEST_META[d].dot }} />
                {d}
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderRadius: 16, border: "1px solid #D4C9FA", padding: "1rem 1.1rem" }}>
          <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>Amount</label>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <input type="number" min="0.001" step="0.001" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
              style={{ flex: 1, background: "transparent", outline: "none", fontSize: 32, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
            <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#f5f3ff", flexShrink: 0 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#627eea", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff" }}>Ξ</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>ETH</span>
            </span>
          </div>
        </div>

        {errorMsg && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}

        {txHash && state === "done" && (
          <div style={{ background: "rgba(34,197,94,0.1)", borderRadius: 12, padding: "1rem" }}>
            <p style={{ color: "#16A34A", fontWeight: 700, marginBottom: 6 }}>Deposit submitted!</p>
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#2563EB", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
              View on Sepolia Etherscan <ExternalLink size={12} />
            </a>
            <p style={{ fontSize: 11, color: "#6B7280", marginTop: 8 }}>It may take a few minutes to appear on {destination}.</p>
          </div>
        )}

        <button onClick={state === "error" ? () => { setState("idle"); setErrorMsg(null); } : doDeposit}
          disabled={isLoading || state === "done"}
          style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "linear-gradient(90deg, #f59e0b, #d97706)", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: isLoading || state === "done" ? "not-allowed" : "pointer", opacity: isLoading || state === "done" ? 0.6 : 1, boxShadow: "0 8px 24px rgba(245,158,11,0.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Zap size={16} />
          {state === "idle" && `Deposit to ${destination}`}
          {isLoading && "Depositing..."}
          {state === "done" && "Done!"}
          {state === "error" && "Try Again"}
        </button>

        {state === "done" && (
          <button onClick={() => { setState("idle"); setTxHash(null); setAmount(""); }}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#4B5563", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            New Deposit
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 10 }}>About this bridge</div>
          <p style={{ fontSize: 12, color: "#4B5563", lineHeight: 1.6, margin: 0 }}>
            Each L2's official canonical bridge locks ETH on Ethereum Sepolia and credits the same amount to your address on the destination rollup. No third-party custody.
          </p>
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>ROUTE</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: "#6B7280" }}>From</span>
            <span style={{ color: "#111827", fontWeight: 600 }}>Ethereum Sepolia</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#6B7280" }}>To</span>
            <span style={{ color: "#111827", fontWeight: 600 }}>{destination}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

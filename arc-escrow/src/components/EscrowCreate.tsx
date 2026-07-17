import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits } from "viem";
import { arcTestnet, USDC_ADDRESS, ARC_CHAIN_ID_HEX, ESCROW_CONTRACT_ADDRESS } from "../chains";

const ESCROW_ABI = [
  {
    type: "function",
    name: "createEscrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "freelancer", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "title", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "escrowCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface EscrowItem {
  id: string;
  contractId: number;
  title: string;
  description: string;
  amount: string;
  freelancer: string;
  client: string;
  status: "pending" | "funded" | "submitted" | "completed" | "refunded";
  txHash?: string;
  createdAt: string;
  deliverable?: string;
}

interface Props {
  provider: EIP1193Provider;
  address: string;
  onCreated: (escrow: EscrowItem) => void;
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

export default function EscrowCreate({ provider, address, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [freelancer, setFreelancer] = useState("");
  const [state, setState] = useState<"idle" | "approving" | "creating" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function create() {
    if (!title) { setError("Enter a title."); return; }
    if (!description) { setError("Enter a description."); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setError("Enter a valid amount."); return; }
    if (!freelancer || !freelancer.startsWith("0x") || freelancer.length !== 42) { setError("Enter a valid freelancer address."); return; }
    if (freelancer.toLowerCase() === address.toLowerCase()) { setError("Freelancer cannot be yourself."); return; }

    setError(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const needed = parseUnits(amount, 6);

      const balance = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
      if ((balance as bigint) < needed) throw new Error("Insufficient USDC balance.");

      // Get the next escrow ID before creating (escrowCount = next id)
      const nextId = await publicClient.readContract({ address: ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: "escrowCount" });

      setState("approving");
      const approveHash = await wc.writeContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [ESCROW_CONTRACT_ADDRESS, needed],
        account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setState("creating");
      const hash = await wc.writeContract({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "createEscrow",
        args: [freelancer as `0x${string}`, needed, title],
        account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setTxHash(hash);
      const escrow: EscrowItem = {
        id: Date.now().toString(),
        contractId: Number(nextId),
        title,
        description,
        amount,
        freelancer,
        client: address,
        status: "funded",
        txHash: hash,
        createdAt: new Date().toISOString(),
      };

      const existing = JSON.parse(localStorage.getItem("arc-escrows") ?? "[]");
      localStorage.setItem("arc-escrows", JSON.stringify([escrow, ...existing]));
      onCreated(escrow);
      setState("done");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Unexpected error."); setState("error");
    }
  }

  if (state === "done") return (
    <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 14, padding: "1.5rem", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
      <h3 style={{ color: "#6ee7b7", fontWeight: 700, marginBottom: 8 }}>Escrow Created!</h3>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>{amount} USDC locked in escrow for "{title}"</p>
      {txHash && <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on Explorer ↗</a>}
      <button onClick={() => { setState("idle"); setTitle(""); setDescription(""); setAmount(""); setFreelancer(""); setTxHash(null); }}
        style={{ display: "block", width: "100%", marginTop: 16, padding: "0.75rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
        Create Another
      </button>
    </div>
  );

  const isLoading = state === "approving" || state === "creating";

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      {[
        { label: "Job Title", value: title, set: setTitle, placeholder: "e.g. Build a landing page" },
        { label: "Description", value: description, set: setDescription, placeholder: "Describe the work to be done..." },
      ].map(({ label, value, set, placeholder }) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>{label}</label>
          <input value={value} onChange={e => set(e.target.value)} disabled={isLoading}
            placeholder={placeholder}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 14, color: "#f1f5f9", outline: "none" }} />
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount (USDC)</label>
        <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} disabled={isLoading} placeholder="0.00"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
          <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>USDC</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Freelancer Address</label>
        <input value={freelancer} onChange={e => setFreelancer(e.target.value)} disabled={isLoading} placeholder="0x..."
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 14, color: "#f1f5f9", outline: "none", fontFamily: "monospace" }} />
      </div>

      {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem", color: "#fca5a5", fontSize: 13 }}>{error}</div>}

      <button onClick={state === "error" ? () => { setState("idle"); setError(null); } : create}
        disabled={isLoading}
        style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
        {state === "idle" && "Create Escrow"}
        {state === "approving" && "Approving USDC..."}
        {state === "creating" && "Creating Escrow..."}
        {state === "error" && "Try Again"}
      </button>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX, ESCROW_CONTRACT_ADDRESS } from "../chains";

const ESCROW_ABI = [
  { type: "function", name: "escrowCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function", name: "getEscrow", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "client", type: "address" },
      { name: "freelancer", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "title", type: "string" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
    ],
  },
  { type: "function", name: "submitWork", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "releaseFunds", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
] as const;

interface OnChainEscrow {
  contractId: number;
  client: string;
  freelancer: string;
  amount: string;
  title: string;
  status: number;
}

const STATUS_LABELS = [
  { label: "Funded",    bg: "rgba(59,130,246,0.1)",  color: "#60a5fa" },
  { label: "Submitted", bg: "rgba(234,179,8,0.1)",   color: "#fbbf24" },
  { label: "Completed", bg: "rgba(16,185,129,0.1)",  color: "#6ee7b7" },
  { label: "Refunded",  bg: "rgba(239,68,68,0.1)",   color: "#fca5a5" },
];

interface Props {
  provider: EIP1193Provider;
  currentAddress: string;
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

export default function EscrowList({ provider, currentAddress }: Props) {
  const [escrows, setEscrows] = useState<OnChainEscrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const count = await publicClient.readContract({ address: ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: "escrowCount" });
      const total = Number(count);
      const items: OnChainEscrow[] = [];
      for (let i = total - 1; i >= 0; i--) {
        const [client, freelancer, amount, title, status] = await publicClient.readContract({
          address: ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: "getEscrow", args: [BigInt(i)],
        }) as [string, string, bigint, string, number, bigint];
        if (client.toLowerCase() === currentAddress.toLowerCase() || freelancer.toLowerCase() === currentAddress.toLowerCase()) {
          items.push({ contractId: i, client, freelancer, amount: Number(formatUnits(amount, 6)).toFixed(2), title, status });
        }
        await new Promise(r => setTimeout(r, 2500));
      }
      setEscrows(items);
    } catch {
      setError("Could not load escrows from chain.");
    } finally {
      setLoading(false);
    }
  }, [currentAddress]);

  useEffect(() => { load(); }, [load]);

  async function callContract(contractId: number, fn: "submitWork" | "releaseFunds" | "refund") {
    setError(null); setActionId(contractId);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const hash = await wc.writeContract({
        address: ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: fn,
        args: [BigInt(contractId)], account: currentAddress as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Transaction failed.");
    } finally {
      setActionId(null);
    }
  }

  if (loading) return <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>Loading escrows from chain...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={load} style={{ background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 12px", color: "#334155", fontSize: 12, cursor: "pointer" }}>Refresh</button>
      </div>

      {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem", color: "#fca5a5", fontSize: 13 }}>{error}</div>}

      {escrows.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>No escrows yet. Create one to get started.</div>
      )}

      {escrows.map((e) => {
        const isClient = e.client.toLowerCase() === currentAddress.toLowerCase();
        const isFreelancer = e.freelancer.toLowerCase() === currentAddress.toLowerCase();
        const statusInfo = STATUS_LABELS[e.status];
        const isLoading = actionId === e.contractId;

        return (
          <div key={e.contractId} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1.1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{e.title}</h3>
              <span style={{ fontSize: 11, fontWeight: 700, color: statusInfo.color, background: statusInfo.bg, padding: "3px 10px", borderRadius: 20 }}>
                {statusInfo.label}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#475569", marginBottom: 4 }}>
              <span>Amount</span>
              <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{e.amount} USDC</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#475569", marginBottom: 4 }}>
              <span>Role</span>
              <span style={{ color: "#818cf8" }}>{isClient ? "Client" : "Freelancer"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#475569", marginBottom: 10 }}>
              <span>{isClient ? "Freelancer" : "Client"}</span>
              <span style={{ fontFamily: "monospace" }}>{(isClient ? e.freelancer : e.client).slice(0, 6)}...{(isClient ? e.freelancer : e.client).slice(-4)}</span>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {isFreelancer && e.status === 0 && (
                <button onClick={() => callContract(e.contractId, "submitWork")} disabled={isLoading}
                  style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "none", background: "rgba(234,179,8,0.15)", color: "#fbbf24", fontSize: 13, fontWeight: 600, cursor: isLoading ? "not-allowed" : "pointer" }}>
                  {isLoading ? "Submitting..." : "Submit Work"}
                </button>
              )}
              {isClient && e.status === 1 && (
                <button onClick={() => callContract(e.contractId, "releaseFunds")} disabled={isLoading}
                  style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "none", background: "rgba(16,185,129,0.15)", color: "#6ee7b7", fontSize: 13, fontWeight: 600, cursor: isLoading ? "not-allowed" : "pointer" }}>
                  {isLoading ? "Releasing..." : "Release Funds"}
                </button>
              )}
              {isClient && (e.status === 0 || e.status === 1) && (
                <button onClick={() => callContract(e.contractId, "refund")} disabled={isLoading}
                  style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)", color: "#fca5a5", fontSize: 13, fontWeight: 600, cursor: isLoading ? "not-allowed" : "pointer" }}>
                  {isLoading ? "Refunding..." : "Refund"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

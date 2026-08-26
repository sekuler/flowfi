import { useState, useEffect } from "react";
import { parseUnits, erc20Abi } from "viem";
import { createWalletClient, createPublicClient, custom, http } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import type { EIP1193Provider } from "viem";
import { Zap, RefreshCw } from "lucide-react";
import { showToast } from "../toast";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo, type CircleChain } from "../circleWalletHelpers";
import {
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_WALLET_ABI,
  GATEWAY_DOMAINS,
  getUnifiedGatewayBalance,
  type GatewayChainKey,
} from "../gatewayHelpers";

const CIRCLE_CHAIN_FOR: Record<GatewayChainKey, CircleChain> = {
  "Arc Testnet": "ARC-TESTNET",
  "Ethereum Sepolia": "ETH-SEPOLIA",
  "Base Sepolia": "BASE-SEPOLIA",
  "Arbitrum Sepolia": "ARB-SEPOLIA",
};

const CHAIN_USDC: Record<GatewayChainKey, `0x${string}`> = {
  "Arc Testnet": "0x3600000000000000000000000000000000000000",
  "Ethereum Sepolia": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  "Base Sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "Arbitrum Sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
};

const CHAIN_OBJECT = {
  "Arc Testnet": arcTestnet,
  "Ethereum Sepolia": sepolia,
  "Base Sepolia": baseSepolia,
  "Arbitrum Sepolia": arbitrumSepolia,
} as const;

const CHAIN_ID_HEX: Record<GatewayChainKey, string> = {
  "Arc Testnet": ARC_CHAIN_ID_HEX,
  "Ethereum Sepolia": "0xaa36a7",
  "Base Sepolia": "0x14a34",
  "Arbitrum Sepolia": "0x66eee",
};

interface Props {
  provider: EIP1193Provider;
  address: string;
}

export default function GatewayPanel({ provider, address }: Props) {
  const [walletMode, setWalletMode] = useState<"browser" | "circle">("browser");
  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [byChain, setByChain] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositChain, setDepositChain] = useState<GatewayChainKey>("Arc Testnet");
  const [depositing, setDepositing] = useState(false);
  const [waitingForBalance, setWaitingForBalance] = useState(false);

  // The address whose Gateway balance we show/deposit against — the browser
  // wallet's own address, or the Circle Developer-Controlled Wallet's
  // address, depending on which mode is selected. Gateway tracks balances
  // per-address with no concept of "the FlowFi user", so these two modes
  // genuinely show different, separate balances.
  const activeAddress = walletMode === "circle" ? circleWallet?.address ?? null : address;

  useEffect(() => {
    setCircleWallet(getCircleWallet());
    const onChange = () => setCircleWallet(getCircleWallet());
    window.addEventListener("circle-wallet-changed", onChange);
    return () => window.removeEventListener("circle-wallet-changed", onChange);
  }, []);

  async function refresh() {
    if (!activeAddress) { setTotal(0); setByChain({}); setLoading(false); return; }
    setLoading(true);
    const result = await getUnifiedGatewayBalance(activeAddress);
    setTotal(result.total);
    setByChain(result.byChain);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAddress]);

  // After a deposit, the on-chain tx confirms quickly but Gateway's own
  // backend needs additional time (source-chain finality + its own
  // processing) before /v1/balances reflects it. A single delayed refresh
  // is often too early — this checks every 4s, up to 60s, and stops as
  // soon as the total genuinely increases.
  async function pollForBalanceIncrease(previousTotal: number) {
    setWaitingForBalance(true);
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((r) => setTimeout(r, 4000));
      const target = walletMode === "circle" ? circleWallet?.address ?? null : address;
      if (!target) break;
      const result = await getUnifiedGatewayBalance(target);
      if (result.total > previousTotal) {
        setTotal(result.total);
        setByChain(result.byChain);
        setWaitingForBalance(false);
        return;
      }
    }
    setWaitingForBalance(false);
    // Final refresh regardless, so the UI at least shows the latest known state.
    refresh();
  }

  async function doDeposit() {
    if (!depositAmount || Number(depositAmount) <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (walletMode === "circle" && !circleWallet) {
      showToast("No Circle Wallet found — create one on the Circle Wallet tab first", "error");
      return;
    }
    setDepositing(true);
    try {
      const usdcAddress = CHAIN_USDC[depositChain];
      const amountUnits = parseUnits(depositAmount, 6);

      if (walletMode === "circle") {
        const walletId = getWalletIdForChain(circleWallet, CIRCLE_CHAIN_FOR[depositChain]);
        if (!walletId) {
          showToast(`Your Circle Wallet doesn't have a ${depositChain} address yet`, "error");
          setDepositing(false);
          return;
        }
        await circleContractCallAndWait({
          walletId, contractAddress: usdcAddress,
          abiFunctionSignature: "approve(address,uint256)",
          abiParameters: [GATEWAY_WALLET_ADDRESS, amountUnits.toString()],
        });
        await circleContractCallAndWait({
          walletId, contractAddress: GATEWAY_WALLET_ADDRESS,
          abiFunctionSignature: "deposit(address,uint256)",
          abiParameters: [usdcAddress, amountUnits.toString()],
        });
      } else {
        const chainObj = CHAIN_OBJECT[depositChain];
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX[depositChain] }] });
        } catch {
          showToast(`Please switch your wallet to ${depositChain} and try again`, "error");
          setDepositing(false);
          return;
        }
        const walletClient = createWalletClient({ chain: chainObj, transport: custom(provider) });
        const publicClient = createPublicClient({ chain: chainObj, transport: http() });

        const approveHash = await walletClient.writeContract({
          address: usdcAddress, abi: erc20Abi, functionName: "approve",
          args: [GATEWAY_WALLET_ADDRESS, amountUnits], account: address as `0x${string}`,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        const depositHash = await walletClient.writeContract({
          address: GATEWAY_WALLET_ADDRESS, abi: GATEWAY_WALLET_ABI, functionName: "deposit",
          args: [usdcAddress, amountUnits], account: address as `0x${string}`,
        });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
      }

      showToast("Deposited — waiting for Gateway to process it...", "success");
      setDepositAmount("");
      pollForBalanceIncrease(total ?? 0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Deposit failed", "error");
    } finally {
      setDepositing(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Zap size={20} color="#3B82F6" />
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Unified Balance</h2>
      </div>
      <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>
        Powered by Circle Gateway — deposit once, access instantly across every supported chain.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#F3F4F6", borderRadius: 10, padding: 4 }}>
        <button onClick={() => setWalletMode("browser")}
          style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: walletMode === "browser" ? "#fff" : "transparent", boxShadow: walletMode === "browser" ? "0 1px 3px rgba(0,0,0,0.1)" : "none", fontSize: 12.5, fontWeight: 700, color: walletMode === "browser" ? "#111827" : "#6B7280", cursor: "pointer" }}>
          Browser Wallet
        </button>
        <button onClick={() => setWalletMode("circle")}
          style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: walletMode === "circle" ? "#fff" : "transparent", boxShadow: walletMode === "circle" ? "0 1px 3px rgba(0,0,0,0.1)" : "none", fontSize: 12.5, fontWeight: 700, color: walletMode === "circle" ? "#111827" : "#6B7280", cursor: "pointer" }}>
          Circle Wallet
        </button>
      </div>

      {walletMode === "circle" && !circleWallet && (
        <div style={{ background: "#FEF3C7", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 12.5, color: "#92400E", marginBottom: 16 }}>
          No Circle Wallet found. Create one on the Circle Wallet tab first.
        </div>
      )}
      {walletMode === "circle" && circleWallet && (
        <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 16, fontFamily: "ui-monospace, monospace" }}>
          {circleWallet.address.slice(0, 8)}...{circleWallet.address.slice(-6)}
        </div>
      )}

      <div style={{ background: "linear-gradient(135deg, #3B82F6, #6D5EF7)", borderRadius: 16, padding: "1.5rem", marginBottom: 20, color: "#fff" }}>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>Total unified balance</div>
        <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>
          {loading ? "..." : `${total?.toFixed(2) ?? "0.00"} USDC`}
        </div>
        {waitingForBalance && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11.5, opacity: 0.9 }}>
            <RefreshCw size={11} className="spin" />
            Processing deposit — Gateway is confirming it...
          </div>
        )}
        <button onClick={refresh} disabled={loading}
          style={{ marginTop: 10, background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 8, padding: "0.4rem 0.8rem", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <RefreshCw size={12} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 8, textTransform: "uppercase" }}>By chain</div>
        {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((chain) => (
          <div key={chain} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
            <span style={{ color: "#374151" }}>{chain}</span>
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{(byChain[chain] ?? 0).toFixed(2)} USDC</span>
          </div>
        ))}
      </div>

      <div style={{ background: "#F9FAFB", borderRadius: 14, padding: "1rem" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Deposit into unified balance</div>
        <select value={depositChain} onChange={(e) => setDepositChain(e.target.value as GatewayChainKey)}
          style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "1px solid #E5E7EB", marginBottom: 8, fontSize: 13 }}>
          {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input type="number" placeholder="Amount (USDC)" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
          style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "1px solid #E5E7EB", marginBottom: 10, fontSize: 13, boxSizing: "border-box" }} />
        <button onClick={doDeposit} disabled={depositing || (walletMode === "circle" && !circleWallet)}
          style={{ width: "100%", padding: "0.7rem", borderRadius: 10, border: "none", background: "#3B82F6", color: "#fff", fontSize: 13, fontWeight: 700, cursor: depositing || (walletMode === "circle" && !circleWallet) ? "not-allowed" : "pointer", opacity: depositing || (walletMode === "circle" && !circleWallet) ? 0.6 : 1 }}>
          {depositing ? "Depositing..." : "Deposit"}
        </button>
        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, marginBottom: 0 }}>
          Requires two confirmations: approve, then deposit. Balance updates after the source chain finalizes.
        </p>
      </div>
    </div>
  );
}

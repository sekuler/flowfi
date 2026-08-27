import { useState, useEffect } from "react";
import { parseUnits, erc20Abi } from "viem";
import { createWalletClient, createPublicClient, custom, http } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import type { EIP1193Provider } from "viem";
import { Zap, RefreshCw, ArrowRight } from "lucide-react";
import { useIsMobile } from "../useIsMobile";
import { showToast } from "../toast";
import { getCircleWallet, circleContractCall, circleContractCallAndWait, getWalletIdForChain, signTypedDataWithCircleWallet, type CircleWalletInfo, type CircleChain } from "../circleWalletHelpers";
import { buildBurnIntentTypedData, requestTransferAttestation, toCircleTypedDataJSON, GATEWAY_MINTER_ADDRESS, GATEWAY_MINTER_ABI, GATEWAY_WALLET_READ_ABI } from "../gatewayTransfer";
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
  const isMobile = useIsMobile();
  const [walletMode, setWalletMode] = useState<"browser" | "circle">("browser");
  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [byChain, setByChain] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositChain, setDepositChain] = useState<GatewayChainKey>("Arc Testnet");
  const [depositing, setDepositing] = useState(false);
  const [waitingForBalance, setWaitingForBalance] = useState(false);

  // Instant transfer (burn on source, mint on destination, <500ms) — browser
  // wallet only for now. Circle Wallet typed-data signing for transfers needs
  // its own verified reference before being added here.
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSource, setTransferSource] = useState<GatewayChainKey>("Arc Testnet");
  const [transferDest, setTransferDest] = useState<GatewayChainKey>("Ethereum Sepolia");
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);

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
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
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

  // Transfers don't raise the total (they only shift the byChain split), so
  // this watches the DESTINATION chain's own balance specifically — a more
  // accurate, faster signal than Circle's own transaction-status polling,
  // which can lag behind the real on-chain/Gateway-ledger result.
  async function pollForChainBalanceIncrease(chain: GatewayChainKey, previousChainBalance: number) {
    setWaitingForBalance(true);
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const target = walletMode === "circle" ? circleWallet?.address ?? null : address;
      if (!target) break;
      const result = await getUnifiedGatewayBalance(target);
      if ((result.byChain[chain] ?? 0) > previousChainBalance) {
        setTotal(result.total);
        setByChain(result.byChain);
        setWaitingForBalance(false);
        showToast(`Transferred ${transferAmount} USDC to ${chain} — confirmed.`, "success");
        return;
      }
    }
    setWaitingForBalance(false);
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

  // Instant transfer: burn on transferSource, mint on transferDest. Requires
  // an existing deposited balance on the source chain (from the Deposit flow
  // above) — this does not deposit anything itself.
  async function doTransfer() {
    if (walletMode === "circle" && !circleWallet) {
      showToast("No Circle Wallet found — create one on the Circle Wallet tab first", "error");
      return;
    }
    setTransferring(true);
    setTransferStatus("Signing burn intent...");
    try {
      const sourceUsdc = CHAIN_USDC[transferSource];
      const destUsdc = CHAIN_USDC[transferDest];
      const transferAddress = walletMode === "circle" ? (circleWallet!.address as `0x${string}`) : (address as `0x${string}`);
      const recipient = (transferRecipient.trim() || transferAddress) as `0x${string}`;
      const amountUnits = parseUnits(transferAmount, 6);

      // Reads (block height, withdrawalDelay) don't need a signer — plain
      // public RPC works the same regardless of wallet mode.
      const sourcePublicClient = createPublicClient({ chain: CHAIN_OBJECT[transferSource], transport: http() });
      const currentBlock = await sourcePublicClient.getBlockNumber();
      const withdrawalDelay = await sourcePublicClient.readContract({
        address: GATEWAY_WALLET_ADDRESS, abi: GATEWAY_WALLET_READ_ABI, functionName: "withdrawalDelay",
      });

      const { domain, types, primaryType, message } = buildBurnIntentTypedData({
        sourceDomain: GATEWAY_DOMAINS[transferSource],
        destinationDomain: GATEWAY_DOMAINS[transferDest],
        sourceTokenAddress: sourceUsdc,
        destinationTokenAddress: destUsdc,
        depositorAddress: transferAddress,
        recipientAddress: recipient,
        amountUnits,
        maxBlockHeight: currentBlock + withdrawalDelay + 1000n, // must clear the wallet's own withdrawalDelay, plus a safety margin
        maxFeeUnits: amountUnits / 100n > 10000n ? amountUnits / 100n : 10000n, // ~1%, floor 0.01 USDC
      });

      let signature: `0x${string}`;
      if (walletMode === "circle") {
        const walletId = getWalletIdForChain(circleWallet, CIRCLE_CHAIN_FOR[transferSource]);
        if (!walletId) throw new Error(`Your Circle Wallet doesn't have a ${transferSource} address yet`);
        signature = await signTypedDataWithCircleWallet(walletId, toCircleTypedDataJSON({ domain, types, primaryType, message }));
      } else {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX[transferSource] }] });
        const walletClient = createWalletClient({ chain: CHAIN_OBJECT[transferSource], transport: custom(provider) });
        signature = await walletClient.signTypedData({ account: transferAddress, domain, types, primaryType, message });
      }

      showToast("Signed — requesting attestation from Gateway...", "success");
      setTransferStatus("Requesting attestation from Gateway...");
      const { attestation, signature: attestationSignature } = await requestTransferAttestation(message, signature);

      if (walletMode === "circle") {
        setTransferStatus("Minting on destination chain...");
        const destWalletId = getWalletIdForChain(circleWallet, CIRCLE_CHAIN_FOR[transferDest]);
        if (!destWalletId) throw new Error(`Your Circle Wallet doesn't have a ${transferDest} address yet`);
        const previousDestBalance = byChain[transferDest] ?? 0;
        // Submit and move on — Circle's own transaction-status tracking can
        // lag behind the real on-chain result, but Gateway's balance ledger
        // updates as soon as the mint is actually mined. Watching the balance
        // directly is the accurate signal here, not Circle's "COMPLETE" state.
        await circleContractCall({
          walletId: destWalletId, contractAddress: GATEWAY_MINTER_ADDRESS,
          abiFunctionSignature: "gatewayMint(bytes,bytes)",
          abiParameters: [attestation, attestationSignature],
        });
        setTransferAmount("");
        setShowTransferConfirm(false);
        setTransferring(false);
        setTransferStatus("");
        pollForChainBalanceIncrease(transferDest, previousDestBalance);
        return;
      } else {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX[transferDest] }] });
        const destWalletClient = createWalletClient({ chain: CHAIN_OBJECT[transferDest], transport: custom(provider) });
        const destPublicClient = createPublicClient({ chain: CHAIN_OBJECT[transferDest], transport: http() });
        const previousDestBalance = byChain[transferDest] ?? 0;
        const mintHash = await destWalletClient.writeContract({
          address: GATEWAY_MINTER_ADDRESS, abi: GATEWAY_MINTER_ABI, functionName: "gatewayMint",
          args: [attestation, attestationSignature], account: transferAddress,
        });
        await destPublicClient.waitForTransactionReceipt({ hash: mintHash });

        // The on-chain mint is confirmed here, but Gateway's own balance
        // ledger can take longer to catch up (same lag we saw on deposits) —
        // so watch the balance directly rather than trusting a short delay.
        setTransferAmount("");
        setShowTransferConfirm(false);
        setTransferring(false);
        setTransferStatus("");
        pollForChainBalanceIncrease(transferDest, previousDestBalance);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transfer failed";
      if (message.toLowerCase().includes("timed out")) {
        // The frontend gave up watching, but Circle's backend may still complete
        // the transaction — don't tell the user it failed when funds may have
        // actually moved. Keep checking the balance in the background.
        showToast("Still processing on Circle's side — we stopped watching, but it may still complete. Checking your balance...", "error");
        setShowTransferConfirm(false);
        setTimeout(refresh, 15000);
      } else {
        showToast(message, "error");
      }
    } finally {
      setTransferring(false);
      setTransferStatus("");
    }
  }

  return (
    <div style={{ maxWidth: isMobile ? 480 : 1150, margin: "0 auto", padding: isMobile ? "1.5rem" : "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Zap size={20} color="#3B82F6" />
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Unified Balance</h2>
      </div>
      <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>
        Powered by Circle Gateway — deposit once, access instantly across every supported chain.
      </p>

      {/* Top section: balance overview (left) + Gateway status (right) */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.6fr 1fr", gap: 20, marginBottom: 20, alignItems: "start" }}>
        <div>
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
                Processing — Gateway is confirming it...
              </div>
            )}
            <button onClick={refresh} disabled={loading}
              style={{ marginTop: 10, background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 8, padding: "0.4rem 0.8rem", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <RefreshCw size={12} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 8, textTransform: "uppercase" }}>By chain</div>
            {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((chain) => (
              <div key={chain} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                <span style={{ color: "#374151" }}>{chain}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{(byChain[chain] ?? 0).toFixed(2)} USDC</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gateway status / supported chains */}
        <div style={{ background: "#F9FAFB", borderRadius: 14, padding: "1.25rem" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", marginBottom: 12 }}>Gateway status</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E" }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#111827" }}>Live on testnet</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", marginBottom: 8 }}>Supported chains</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((c) => (
              <div key={c} style={{ fontSize: 12.5, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#3B82F6" }} />
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Deposit (left) + Instant transfer (right) */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr", gap: 20 }}>
        <div style={{ background: "#F9FAFB", borderRadius: 14, padding: isMobile ? "1rem" : "1.5rem" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Deposit into unified balance</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <select value={depositChain} onChange={(e) => setDepositChain(e.target.value as GatewayChainKey)}
              style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" }}>
              {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input type="number" placeholder="Amount (USDC)" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
              style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" }} />
            <button onClick={doDeposit} disabled={depositing || (walletMode === "circle" && !circleWallet)}
              style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "none", background: "#3B82F6", color: "#fff", fontSize: 13, fontWeight: 700, cursor: depositing || (walletMode === "circle" && !circleWallet) ? "not-allowed" : "pointer", opacity: depositing || (walletMode === "circle" && !circleWallet) ? 0.6 : 1 }}>
              {depositing ? "Depositing..." : "Deposit"}
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, marginBottom: 0 }}>
            Requires two confirmations: approve, then deposit. Balance updates after the source chain finalizes.
          </p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: isMobile ? "1.25rem" : "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={16} color="#3B82F6" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Instant transfer <span style={{ color: "#3B82F6" }}>&lt;500ms</span></div>
          </div>
          <p style={{ fontSize: 12.5, color: "#9CA3AF", marginTop: 0, marginBottom: 14 }}>
            Move part of your deposited balance to another chain instantly, without a new deposit.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <select value={transferSource} onChange={(e) => setTransferSource(e.target.value as GatewayChainKey)}
              style={{ width: "100%", padding: "0.65rem", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" }}>
              {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((c) => (
                <option key={c} value={c}>From: {c}</option>
              ))}
            </select>
            <select value={transferDest} onChange={(e) => setTransferDest(e.target.value as GatewayChainKey)}
              style={{ width: "100%", padding: "0.65rem", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" }}>
              {(Object.keys(GATEWAY_DOMAINS) as GatewayChainKey[]).map((c) => (
                <option key={c} value={c}>To: {c}</option>
              ))}
            </select>
            <input type="number" placeholder="Amount (USDC)" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)}
              style={{ width: "100%", padding: "0.65rem", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" }} />
            <input type="text" placeholder="Recipient address (optional — defaults to you)" value={transferRecipient} onChange={(e) => setTransferRecipient(e.target.value)}
              style={{ width: "100%", padding: "0.65rem", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" }} />
            <button
              onClick={() => {
                if (!transferAmount || Number(transferAmount) <= 0) { showToast("Enter a valid amount", "error"); return; }
                if (transferSource === transferDest) { showToast("Source and destination must be different", "error"); return; }
                setShowTransferConfirm(true);
              }}
              disabled={transferring}
              style={{ width: "100%", padding: "0.7rem", borderRadius: 10, border: "none", background: "#111827", color: "#fff", fontSize: 13, fontWeight: 700, cursor: transferring ? "not-allowed" : "pointer", opacity: transferring ? 0.6 : 1 }}>
              Review Transfer
            </button>
          </div>
        </div>
      </div>

      {showTransferConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "1.5rem", maxWidth: 380, width: "100%" }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, marginTop: 0, marginBottom: 12 }}>Confirm transfer</h3>
            <div style={{ fontSize: 13, color: "#374151", display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Amount</span><b>{transferAmount} USDC</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Route</span>
                <b style={{ display: "flex", alignItems: "center", gap: 4 }}>{transferSource} <ArrowRight size={12} /> {transferDest}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Recipient</span><b style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{(transferRecipient.trim() || (walletMode === "circle" ? circleWallet?.address : address) || "").slice(0, 10)}...</b></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowTransferConfirm(false)} disabled={transferring}
                style={{ flex: 1, padding: "0.7rem", borderRadius: 10, border: "1px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={doTransfer} disabled={transferring}
                style={{ flex: 1, padding: "0.7rem", borderRadius: 10, border: "none", background: "#111827", color: "#fff", fontSize: 13, fontWeight: 700, cursor: transferring ? "not-allowed" : "pointer", opacity: transferring ? 0.6 : 1 }}>
                {transferring ? (transferStatus || "Signing...") : "Confirm & Sign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

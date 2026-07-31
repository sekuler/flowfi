import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, erc20Abi } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import EthBridge from "./EthBridge";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo, type CircleChain } from "../circleWalletHelpers";

const TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa" as `0x${string}`;
const MESSAGE_TRANSMITTER = "0xe737e5cebeeba77efe34d4aa090756590b1ce275" as `0x${string}`;
const IRIS_API = "https://iris-api-sandbox.circle.com/v2/messages";

const CHAINS = {
  "Arc Testnet": { chain: arcTestnet, domain: 26, usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`, chainIdHex: ARC_CHAIN_ID_HEX, isArc: true, circleChain: "ARC-TESTNET" as CircleChain },
  "Ethereum Sepolia": { chain: sepolia, domain: 0, usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as `0x${string}`, chainIdHex: "0xaa36a7", isArc: false, circleChain: "ETH-SEPOLIA" as CircleChain },
  "Base Sepolia": { chain: baseSepolia, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, chainIdHex: "0x14a34", isArc: false, circleChain: "BASE-SEPOLIA" as CircleChain },
  "Arbitrum Sepolia": { chain: arbitrumSepolia, domain: 3, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`, chainIdHex: "0x66eee", isArc: false, circleChain: "ARB-SEPOLIA" as CircleChain },
} as const;
type ChainKey = keyof typeof CHAINS;

interface Props {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
}

interface RecentBridge {
  hash: string;
  age: string;
}

const DEMO_BRIDGES: RecentBridge[] = [
  { hash: "demo1", age: "18s ago" },
  { hash: "demo2", age: "1m ago" },
  { hash: "demo3", age: "4m ago" },
  { hash: "demo4", age: "9m ago" },
];

const DEPOSIT_FOR_BURN_ABI = [{
  type: "function", name: "depositForBurn", stateMutability: "nonpayable",
  inputs: [
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "mintRecipient", type: "bytes32" },
    { name: "burnToken", type: "address" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32" },
  ],
  outputs: [],
}] as const;

const RECEIVE_MESSAGE_ABI = [{
  type: "function", name: "receiveMessage", stateMutability: "nonpayable",
  inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
  outputs: [],
}] as const;

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function switchChain(provider: EIP1193Provider, chainIdHex: string, addParams?: any) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902 && addParams) {
      await provider.request({ method: "wallet_addEthereumChain", params: [addParams] });
    } else throw e;
  }
}

function addChainParams(key: ChainKey) {
  const c = CHAINS[key];
  if (key === "Arc Testnet") {
    return { chainId: c.chainIdHex, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://arc-testnet.g.alchemy.com/v2/alch_1L2dTNapY_mz3YEIsoVEN"], blockExplorerUrls: ["https://testnet.arcscan.app"] };
  }
  return {
    chainId: c.chainIdHex, chainName: key,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: [c.chain.rpcUrls.default.http[0]],
    blockExplorerUrls: [c.chain.blockExplorers?.default.url ?? ""],
  };
}

function bytes32Address(addr: string): `0x${string}` {
  return `0x000000000000000000000000${addr.slice(2)}` as `0x${string}`;
}

const STEP_ORDER = ["approving", "burning", "attesting", "minting"] as const;
const STEP_LABELS_SHORT: Record<string, string> = { approving: "Approve", burning: "Burn", attesting: "Attest", minting: "Mint" };

export default function BridgeForm({ provider, address }: Props) {
  const [bridgeType, setBridgeType] = useState<"usdc" | "eth">("usdc");
  const [sourceKey, setSourceKey] = useState<ChainKey>("Ethereum Sepolia");
  const [destKey, setDestKey] = useState<ChainKey>("Arc Testnet");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "burning" | "attesting" | "minting" | "done" | "error">("idle");
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentBridges, setRecentBridges] = useState<RecentBridge[]>([]);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => { setCircleWallet(getCircleWallet()); }, []);

  const source = CHAINS[sourceKey];
  const dest = CHAINS[destKey];

  function changeSource(key: ChainKey) {
    setSourceKey(key);
    if (key === destKey) {
      const fallback = (Object.keys(CHAINS) as ChainKey[]).find((k) => k !== key);
      if (fallback) setDestKey(fallback);
    }
  }
  function changeDest(key: ChainKey) {
    setDestKey(key);
    if (key === sourceKey) {
      const fallback = (Object.keys(CHAINS) as ChainKey[]).find((k) => k !== key);
      if (fallback) setSourceKey(fallback);
    }
  }

  async function loadRecentBridges() {
    try {
      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${MESSAGE_TRANSMITTER}&limit=6`);
      const data = await res.json();
      const items: RecentBridge[] = (data.result ?? []).slice(0, 6).map((tx: any) => ({
        hash: tx.hash,
        age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
      }));
      setRecentBridges(items);
    } catch {
      setRecentBridges([]);
    }
  }

  useEffect(() => { loadRecentBridges(); }, [mintTxHash]);

  async function pollAttestation(burnHash: string, domain: number) {
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${IRIS_API}/${domain}?transactionHash=${burnHash}`);
      if (res.ok) {
        const data = await res.json();
        const msg = data?.messages?.[0];
        if (msg?.status === "complete") return msg as { message: string; attestation: string };
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error("Attestation timed out. Try minting later using the burn tx hash.");
  }

  async function doBridgeWithCircle() {
    if (!circleWallet) return;
    const sourceWalletId = getWalletIdForChain(circleWallet, source.circleChain);
    const destWalletId = getWalletIdForChain(circleWallet, dest.circleChain);
    if (!sourceWalletId || !destWalletId) {
      setErrorMsg(`Circle Wallet is missing an account on ${!sourceWalletId ? sourceKey : destKey}.`);
      setStep("error");
      return;
    }
    const amountUnits = BigInt(Math.round(Number(amount) * 1e6));

    setStep("approving");
    await circleContractCallAndWait({
      walletId: sourceWalletId,
      contractAddress: source.usdc,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [TOKEN_MESSENGER, amountUnits.toString()],
    });

    setStep("burning");
    const burnHash = await circleContractCallAndWait({
      walletId: sourceWalletId,
      contractAddress: TOKEN_MESSENGER,
      abiFunctionSignature: "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
      abiParameters: [
        amountUnits.toString(),
        dest.domain,
        bytes32Address(circleWallet.address),
        source.usdc,
        bytes32Address("0x0000000000000000000000000000000000000000"),
        "500",
        1000,
      ],
    });
    setBurnTxHash(burnHash);

    setStep("attesting");
    const attestation = await pollAttestation(burnHash, source.domain);

    setStep("minting");
    const mintHash = await circleContractCallAndWait({
      walletId: destWalletId,
      contractAddress: MESSAGE_TRANSMITTER,
      abiFunctionSignature: "receiveMessage(bytes,bytes)",
      abiParameters: [attestation.message, attestation.attestation],
    });
    setMintTxHash(mintHash);
    setStep("done");
    showToast("Bridge completed", "success");
  }

  async function doBridge() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMsg("Enter a valid amount."); return;
    }
    if (sourceKey === destKey) {
      setErrorMsg("Source and destination must be different."); return;
    }
    setErrorMsg(null);
    setBurnTxHash(null);
    setMintTxHash(null);

    if (useCircle && circleWallet) {
      try {
        await doBridgeWithCircle();
      } catch (e: unknown) {
        const err = e as { message?: string };
        setErrorMsg(err.message ?? "Bridge failed.");
        setStep("error");
      }
      return;
    }

    try {
      const amountUnits = BigInt(Math.round(Number(amount) * 1e6));
      await switchChain(provider, source.chainIdHex, addChainParams(sourceKey));
      const sourceWallet = createWalletClient({ chain: source.chain, transport: custom(provider) });
      const sourcePublic = createPublicClient({ chain: source.chain, transport: http() });

      setStep("approving");
      const approveHash = await sourceWallet.writeContract({
        address: source.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [TOKEN_MESSENGER, amountUnits],
        account: address as `0x${string}`,
      });
      await sourcePublic.waitForTransactionReceipt({ hash: approveHash });

      setStep("burning");
      const burnHash = await sourceWallet.writeContract({
        address: TOKEN_MESSENGER,
        abi: DEPOSIT_FOR_BURN_ABI,
        functionName: "depositForBurn",
        args: [
          amountUnits,
          dest.domain,
          bytes32Address(address),
          source.usdc,
          bytes32Address("0x0000000000000000000000000000000000000000"),
          500n,
          1000,
        ],
        account: address as `0x${string}`,
      });
      await sourcePublic.waitForTransactionReceipt({ hash: burnHash });
      setBurnTxHash(burnHash);

      setStep("attesting");
      const attestation = await pollAttestation(burnHash, source.domain);

      setStep("minting");
      await switchChain(provider, dest.chainIdHex, addChainParams(destKey));
      const destWallet = createWalletClient({ chain: dest.chain, transport: custom(provider) });
      const destPublic = createPublicClient({ chain: dest.chain, transport: http() });
      const mintHash = await destWallet.writeContract({
        address: MESSAGE_TRANSMITTER,
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attestation.message as `0x${string}`, attestation.attestation as `0x${string}`],
        account: address as `0x${string}`,
      });
      await destPublic.waitForTransactionReceipt({ hash: mintHash });
      setMintTxHash(mintHash);
      setStep("done");
      showToast("Bridge completed", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Bridge failed.");
      setStep("error");
    }
  }

  const isLoading = step === "approving" || step === "burning" || step === "attesting" || step === "minting";
  const stepLabels: Record<string, string> = {
    approving: "Approving USDC on " + sourceKey + "...",
    burning: "Burning USDC on " + sourceKey + "...",
    attesting: "Waiting for Circle attestation (can take 1-2 min)...",
    minting: "Minting USDC on " + destKey + "...",
  };

  const tickerItems = recentBridges.length > 0 ? recentBridges : DEMO_BRIDGES;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setBridgeType("usdc")}
            style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: bridgeType === "usdc" ? "#ede9fe" : "#ffffff", color: bridgeType === "usdc" ? "#a855f7" : "#4B5563", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            USDC Bridge
          </button>
          <button onClick={() => setBridgeType("eth")}
            style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: bridgeType === "eth" ? "#ede9fe" : "#ffffff", color: bridgeType === "eth" ? "#a855f7" : "#4B5563", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            ETH Bridge
          </button>
        </div>

        {bridgeType === "eth" && <EthBridge provider={provider} address={address} />}

        {bridgeType === "usdc" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem", alignItems: "start", width: "100%" }}>
            <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
              {circleWallet && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setUseCircle(false)} disabled={isLoading}
                    style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: !useCircle ? "#ede9fe" : "#f5f3ff", color: !useCircle ? "#a855f7" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    Browser Wallet
                  </button>
                  <button onClick={() => setUseCircle(true)} disabled={isLoading}
                    style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: useCircle ? "#ede9fe" : "#f5f3ff", color: useCircle ? "#a855f7" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    Circle Wallet
                  </button>
                </div>
              )}

              <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.65rem 0.85rem" }}>
                <p style={{ fontSize: 12, color: "#a855f7", margin: 0 }}>
                  {useCircle
                    ? "Circle Wallet signs both the burn and the mint automatically — no chain switching, no popups."
                    : "Real CCTP V2 bridge — burn on any supported chain, mint native USDC on any other."}
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px" }}>From</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(Object.keys(CHAINS) as ChainKey[]).map((key) => (
                    <button key={key} onClick={() => changeSource(key)} disabled={isLoading}
                      style={{ flex: "1 1 45%", padding: "0.6rem", borderRadius: 10, border: "none", background: sourceKey === key ? "#ede9fe" : "#f5f3ff", color: sourceKey === key ? "#a855f7" : "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.75rem 1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 220 }}>
                  <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{sourceKey}</div>
                  <div style={{ color: "#7c3aed", fontSize: 18 }}>↓</div>
                  <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{destKey}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px" }}>To</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(Object.keys(CHAINS) as ChainKey[]).map((key) => (
                    <button key={key} onClick={() => changeDest(key)} disabled={isLoading}
                      style={{ flex: "1 1 45%", padding: "0.6rem", borderRadius: 10, border: "none", background: destKey === key ? "#ede9fe" : "#f5f3ff", color: destKey === key ? "#a855f7" : "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.7rem 0.6rem", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#4B5563", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 3 }}>EST. TIME</div>
                  <div style={{ fontSize: 13, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>~20 sec</div>
                </div>
                <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.7rem 0.6rem", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#4B5563", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 3 }}>MAX FEE</div>
                  <div style={{ fontSize: 13, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>0.0005 USDC</div>
                </div>
                <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.7rem 0.6rem", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#4B5563", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 3 }}>YOU RECEIVE</div>
                  <div style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>Native USDC</div>
                </div>
              </div>

              <div style={{ borderRadius: 16, background: "#f5f3ff", padding: "1rem 1.1rem" }}>
                <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 10 }}>Amount</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                    style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 32, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                  <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#ede9fe" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#ffffff" }}>U</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>USDC</span>
                  </span>
                </div>
              </div>

              {(isLoading || step === "done") && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0.5rem 0" }}>
                  {STEP_ORDER.map((s, i) => {
                    const currentIndex = STEP_ORDER.indexOf(step as any);
                    const isDone = step === "done" || currentIndex > i;
                    const isActive = step === s;
                    const isLast = i === STEP_ORDER.length - 1;
                    return (
                      <div key={s} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 800,
                            background: isDone ? "#7c3aed" : isActive ? "#ede9fe" : "#f5f3ff",
                            color: isDone ? "#ffffff" : isActive ? "#a855f7" : "#374151",
                          }}>
                            {isDone ? "✓" : i + 1}
                          </div>
                          <span style={{ fontSize: 9, color: isDone ? "#7c3aed" : isActive ? "#a855f7" : "#374151" }}>{STEP_LABELS_SHORT[s]}</span>
                        </div>
                        {!isLast && <div style={{ height: 2, flex: 1, background: isDone ? "#7c3aed" : "#f5f3ff", marginBottom: 14 }} />}
                      </div>
                    );
                  })}
                </div>
              )}

              {isLoading && (
                <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.75rem 1rem" }}>
                  <p style={{ fontSize: 13, color: "#a855f7", margin: 0 }}>{stepLabels[step]}</p>
                </div>
              )}

              {errorMsg && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}

              {burnTxHash && (
                <a href={`${source.chain.blockExplorers?.default.url}/tx/${burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#60a5fa" }}>
                  Burn Tx on {sourceKey} ↗
                </a>
              )}
              {mintTxHash && (
                <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 12, padding: "1rem" }}>
                  <p style={{ color: "#7c3aed", fontWeight: 700, marginBottom: 6 }}>Bridge complete!</p>
                  <a href={`${dest.chain.blockExplorers?.default.url ?? "https://testnet.arcscan.app"}/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View mint on {destKey} ↗</a>
                </div>
              )}

              <button onClick={step === "error" ? () => { setStep("idle"); setErrorMsg(null); } : doBridge}
                disabled={isLoading || step === "done"}
                style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: isLoading || step === "done" ? "not-allowed" : "pointer", opacity: isLoading || step === "done" ? 0.5 : 1 }}>
                {step === "idle" && `Bridge to ${destKey}`}
                {isLoading && "Processing..."}
                {step === "done" && "Done!"}
                {step === "error" && "Try Again"}
              </button>

              {step === "done" && (
                <button onClick={() => { setStep("idle"); setBurnTxHash(null); setMintTxHash(null); setAmount(""); }}
                  style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#4B5563", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  New Bridge
                </button>
              )}

              <div style={{ background: "#ffffff", borderRadius: 12, padding: "0.6rem 0.875rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
                <p style={{ fontSize: 11, color: "#4B5563", lineHeight: 1.5, margin: 0 }}>
                  {useCircle
                    ? "Circle Wallet needs USDC and native gas on both the source and destination chains."
                    : `Requires native gas on ${sourceKey} and USDC to bridge.`} Get test tokens from{" "}
                  <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>faucet.circle.com</a>.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
                <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>ABOUT CCTP V2</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>
                  <p style={{ margin: 0 }}>Circle's Cross-Chain Transfer Protocol burns USDC on the source chain and mints native USDC on the destination — no wrapped tokens, no bridge risk. Now supports any-to-any transfers among Arc, Ethereum Sepolia, Base Sepolia, and Arbitrum Sepolia.</p>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#4B5563" }}>Protocol</span>
                    <span style={{ color: "#111827", fontWeight: 600 }}>CCTP V2</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#4B5563" }}>Route</span>
                    <span style={{ color: "#111827", fontWeight: 600 }}>{sourceKey} → {destKey}</span>
                  </div>
                </div>
              </div>

              <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
                <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT BRIDGES TO ARC</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {tickerItems.map((b) => (
                    <a key={b.hash} href={b.hash.startsWith("demo") ? undefined : `https://testnet.arcscan.app/tx/${b.hash}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.7rem", borderRadius: 10, background: "#f5f3ff", textDecoration: "none", cursor: b.hash.startsWith("demo") ? "default" : "pointer" }}>
                      <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>Mint</span>
                      <span style={{ fontSize: 11, color: "#374151" }}>{b.age}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, erc20Abi } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import EthBridge from "./EthBridge";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo, type CircleChain } from "../circleWalletHelpers";
import { ShieldCheck, Zap, Globe, ChevronDown, ArrowDownUp, BookOpen } from "lucide-react";

const TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa" as `0x${string}`;
const MESSAGE_TRANSMITTER = "0xe737e5cebeeba77efe34d4aa090756590b1ce275" as `0x${string}`;
const IRIS_API = "https://iris-api-sandbox.circle.com/v2/messages";

const CHAINS = {
  "Arc Testnet": { chain: arcTestnet, domain: 26, usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`, chainIdHex: ARC_CHAIN_ID_HEX, isArc: true, circleChain: "ARC-TESTNET" as CircleChain, dot: "#6D5EF7" },
  "Ethereum Sepolia": { chain: sepolia, domain: 0, usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as `0x${string}`, chainIdHex: "0xaa36a7", isArc: false, circleChain: "ETH-SEPOLIA" as CircleChain, dot: "#627eea" },
  "Base Sepolia": { chain: baseSepolia, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, chainIdHex: "0x14a34", isArc: false, circleChain: "BASE-SEPOLIA" as CircleChain, dot: "#0052ff" },
  "Arbitrum Sepolia": { chain: arbitrumSepolia, domain: 3, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`, chainIdHex: "0x66eee", isArc: false, circleChain: "ARB-SEPOLIA" as CircleChain, dot: "#28a0f0" },
} as const;
type ChainKey = keyof typeof CHAINS;

interface Props {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
}

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

const HOW_IT_WORKS = [
  { title: "Select assets", desc: "Choose the chains and USDC amount you want to bridge" },
  { title: "Approve & Burn", desc: "Approve the transfer and burn USDC on the source chain" },
  { title: "Attestation", desc: "Circle verifies the burn and issues a signed attestation" },
  { title: "Receive on destination", desc: "Native USDC is minted directly to your wallet" },
];

export default function BridgeForm({ provider, address }: Props) {
  const [bridgeType, setBridgeType] = useState<"usdc" | "eth">("usdc");
  const [sourceKey, setSourceKey] = useState<ChainKey>("Ethereum Sepolia");
  const [destKey, setDestKey] = useState<ChainKey>("Arc Testnet");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [destOpen, setDestOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "burning" | "attesting" | "minting" | "done" | "error">("idle");
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => { setCircleWallet(getCircleWallet()); }, []);

  const source = CHAINS[sourceKey];
  const dest = CHAINS[destKey];

  function changeSource(key: ChainKey) {
    setSourceKey(key);
    setSourceOpen(false);
    if (key === destKey) {
      const fallback = (Object.keys(CHAINS) as ChainKey[]).find((k) => k !== key);
      if (fallback) setDestKey(fallback);
    }
  }
  function changeDest(key: ChainKey) {
    setDestKey(key);
    setDestOpen(false);
    if (key === sourceKey) {
      const fallback = (Object.keys(CHAINS) as ChainKey[]).find((k) => k !== key);
      if (fallback) setSourceKey(fallback);
    }
  }
  function flipChains() {
    const s = sourceKey, d = destKey;
    setSourceKey(d);
    setDestKey(s);
  }

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
  const stepIndexMap: Record<string, number> = { idle: -1, approving: 1, burning: 1, attesting: 2, minting: 3, done: 4, error: -1 };
  const activeStepIndex = stepIndexMap[step] ?? -1;

  function ChainRow({ chainKey, open, setOpen, onSelect }: { chainKey: ChainKey; open: boolean; setOpen: (v: boolean) => void; onSelect: (k: ChainKey) => void }) {
    const c = CHAINS[chainKey];
    return (
      <div style={{ position: "relative" }}>
        <button onClick={() => setOpen(!open)} disabled={isLoading}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderRadius: 14, border: "1px solid #D4C9FA", background: "#ffffff", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{chainKey}</span>
          </div>
          <ChevronDown size={16} color="#6B7280" />
        </button>
        {open && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20, background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 14, padding: 6, boxShadow: "0 12px 30px rgba(109,94,247,0.18)" }}>
            {(Object.keys(CHAINS) as ChainKey[]).map((k) => (
              <button key={k} onClick={() => onSelect(k)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.75rem", borderRadius: 10, border: "none", background: k === chainKey ? "#f5f3ff" : "transparent", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: CHAINS[k].dot }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{k}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setBridgeType("usdc")}
          style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: bridgeType === "usdc" ? "#ede9fe" : "#ffffff", color: bridgeType === "usdc" ? "#5B21B6" : "#4B5563", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          USDC Bridge
        </button>
        <button onClick={() => setBridgeType("eth")}
          style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: bridgeType === "eth" ? "#ede9fe" : "#ffffff", color: bridgeType === "eth" ? "#5B21B6" : "#4B5563", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          ETH Bridge
        </button>
      </div>

      {bridgeType === "eth" && <EthBridge provider={provider} address={address} />}

      {bridgeType === "usdc" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "1.25rem", alignItems: "start" }}>
          <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}>
            {circleWallet && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setUseCircle(false)} disabled={isLoading}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: !useCircle ? "#ede9fe" : "#f5f3ff", color: !useCircle ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Browser Wallet
                </button>
                <button onClick={() => setUseCircle(true)} disabled={isLoading}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: useCircle ? "#ede9fe" : "#f5f3ff", color: useCircle ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Circle Wallet
                </button>
              </div>
            )}

            <div>
              <label style={{ fontSize: 13, color: "#4B5563", fontWeight: 600 }}>From</label>
              <div style={{ marginTop: 6 }}>
                <ChainRow chainKey={sourceKey} open={sourceOpen} setOpen={setSourceOpen} onSelect={changeSource} />
              </div>
            </div>

            <div style={{ borderRadius: 16, border: "1px solid #D4C9FA", padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <input type="number" min="0" step="0.01" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                  style={{ flex: 1, minWidth: 0, background: "transparent", outline: "none", fontSize: 32, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#f5f3ff" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>$</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>USDC</span>
                </span>
              </div>
              <div className="flowfi-mono" style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>{amount ? `$${Number(amount).toFixed(2)}` : "$0.00"}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: -6, marginBottom: -6 }}>
              <button onClick={flipChains} disabled={isLoading}
                style={{ width: 34, height: 34, borderRadius: 10, background: "#ffffff", border: "1px solid #D4C9FA", color: "#6D5EF7", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(109,94,247,0.1)" }}>
                <ArrowDownUp size={15} />
              </button>
            </div>

            <div>
              <label style={{ fontSize: 13, color: "#4B5563", fontWeight: 600 }}>To</label>
              <div style={{ marginTop: 6 }}>
                <ChainRow chainKey={destKey} open={destOpen} setOpen={setDestOpen} onSelect={changeDest} />
              </div>
            </div>

            <div style={{ borderRadius: 16, border: "1px solid #D4C9FA", padding: "1rem 1.1rem", background: "#f5f3ff" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <span className="flowfi-mono" style={{ fontSize: 32, fontWeight: 700, color: "#111827" }}>{amount ? Number(amount).toFixed(2) : "0"}</span>
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#ffffff" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>$</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>USDC</span>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>Estimated — native USDC, no wrapped tokens</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>Est. time</div>
                <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>~20 sec</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>Network fee</div>
                <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>0.0005 USDC</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>You receive</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Native USDC</div>
              </div>
            </div>

            {(isLoading || step === "done") && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {["Approve", "Burn", "Attest", "Mint"].map((label, i) => {
                  const isDone = step === "done" || activeStepIndex > i;
                  const isActive = activeStepIndex === i && step !== "done";
                  const isLast = i === 3;
                  return (
                    <div key={label} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, background: isDone ? "#6D5EF7" : isActive ? "#ede9fe" : "#f5f3ff", color: isDone ? "#fff" : isActive ? "#5B21B6" : "#9CA3AF" }}>
                          {isDone ? "✓" : i + 1}
                        </div>
                        <span style={{ fontSize: 9, color: isDone ? "#6D5EF7" : isActive ? "#5B21B6" : "#9CA3AF" }}>{label}</span>
                      </div>
                      {!isLast && <div style={{ height: 2, flex: 1, background: isDone ? "#6D5EF7" : "#E5E0FA", marginBottom: 14 }} />}
                    </div>
                  );
                })}
              </div>
            )}

            {isLoading && (
              <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.75rem 1rem" }}>
                <p style={{ fontSize: 13, color: "#5B21B6", margin: 0 }}>{stepLabels[step]}</p>
              </div>
            )}

            {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}

            {burnTxHash && (
              <a href={`${source.chain.blockExplorers?.default.url}/tx/${burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#2563EB" }}>
                Burn Tx on {sourceKey} ↗
              </a>
            )}
            {mintTxHash && (
              <div style={{ background: "rgba(34,197,94,0.1)", borderRadius: 12, padding: "1rem" }}>
                <p style={{ color: "#16A34A", fontWeight: 700, marginBottom: 6 }}>Bridge complete!</p>
                <a href={`${dest.chain.blockExplorers?.default.url ?? "https://testnet.arcscan.app"}/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#2563EB", fontSize: 13 }}>View mint on {destKey} ↗</a>
              </div>
            )}

            <button onClick={step === "error" ? () => { setStep("idle"); setErrorMsg(null); } : doBridge}
              disabled={isLoading || step === "done"}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "linear-gradient(90deg, #6D5EF7, #4F6BFF)", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: isLoading || step === "done" ? "not-allowed" : "pointer", opacity: isLoading || step === "done" ? 0.5 : 1, boxShadow: "0 8px 24px rgba(109,94,247,0.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <ArrowDownUp size={16} />
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

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, color: "#6B7280" }}>
              <ShieldCheck size={14} color="#6D5EF7" />
              Secured by Circle CCTP v2
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 14 }}>How it works</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {HOW_IT_WORKS.map((s, i) => (
                  <div key={s.title} style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#ede9fe", color: "#5B21B6", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{s.title}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 1 }}>{s.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 10 }}>
                <BookOpen size={15} color="#6D5EF7" /> About CCTP V2
              </div>
              <p style={{ fontSize: 12, color: "#4B5563", lineHeight: 1.6, margin: "0 0 10px 0" }}>
                Circle's Cross-Chain Transfer Protocol burns USDC on the source chain and mints native USDC on the destination — no wrapped tokens, no bridge risk.
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#6B7280" }}>Protocol</span>
                <span style={{ color: "#111827", fontWeight: 600 }}>CCTP V2</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "#6B7280" }}>Route</span>
                <span style={{ color: "#111827", fontWeight: 600 }}>{sourceKey} → {destKey}</span>
              </div>
            </div>

            <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Zap size={14} color="#6D5EF7" />
                <span style={{ fontSize: 12, color: "#4B5563" }}><b style={{ color: "#111827" }}>Fast</b> — transfers under 2 minutes</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Globe size={14} color="#6D5EF7" />
                <span style={{ fontSize: 12, color: "#4B5563" }}><b style={{ color: "#111827" }}>4 chains</b> — Arc, Ethereum, Base, Arbitrum</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={14} color="#6D5EF7" />
                <span style={{ fontSize: 12, color: "#4B5563" }}><b style={{ color: "#111827" }}>Secure</b> — audited by Circle</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

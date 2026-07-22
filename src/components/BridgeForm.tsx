import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, erc20Abi } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";

const TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa" as `0x${string}`;
const ARC_MESSAGE_TRANSMITTER = "0xe737e5cebeeba77efe34d4aa090756590b1ce275" as `0x${string}`;
const IRIS_API = "https://iris-api-sandbox.circle.com/v2/messages";
const ARC_DOMAIN = 26;

const SOURCE_CHAINS = {
  "Ethereum Sepolia": { chain: sepolia, domain: 0, usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as `0x${string}`, chainIdHex: "0xaa36a7" },
  "Base Sepolia": { chain: baseSepolia, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, chainIdHex: "0x14a34" },
  "Arbitrum Sepolia": { chain: arbitrumSepolia, domain: 3, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`, chainIdHex: "0x66eee" },
} as const;

type SourceChainKey = keyof typeof SOURCE_CHAINS;

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

export default function BridgeForm({ provider, address }: Props) {
  const [sourceKey, setSourceKey] = useState<SourceChainKey>("Ethereum Sepolia");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "burning" | "attesting" | "minting" | "done" | "error">("idle");
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const source = SOURCE_CHAINS[sourceKey];

  function bytes32Address(addr: string): `0x${string}` {
    return `0x000000000000000000000000${addr.slice(2)}` as `0x${string}`;
  }

  async function doBridge() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMsg("Enter a valid amount."); return;
    }
    setErrorMsg(null);
    setBurnTxHash(null);
    setMintTxHash(null);

    try {
      const amountUnits = BigInt(Math.round(Number(amount) * 1e6));

      await switchChain(provider, source.chainIdHex, {
        chainId: source.chainIdHex,
        chainName: sourceKey,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [source.chain.rpcUrls.default.http[0]],
        blockExplorerUrls: [source.chain.blockExplorers?.default.url ?? ""],
      });

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
          ARC_DOMAIN,
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
      let attestation: { message: string; attestation: string } | null = null;
      for (let i = 0; i < 60; i++) {
        const res = await fetch(`${IRIS_API}/${source.domain}?transactionHash=${burnHash}`);
        if (res.ok) {
          const data = await res.json();
          const msg = data?.messages?.[0];
          if (msg?.status === "complete") {
            attestation = msg;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!attestation) throw new Error("Attestation timed out. Try minting later using the burn tx hash.");

      setStep("minting");
      await switchChain(provider, ARC_CHAIN_ID_HEX, {
        chainId: ARC_CHAIN_ID_HEX,
        chainName: "Arc Testnet",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: ["https://rpc.testnet.arc.network"],
        blockExplorerUrls: ["https://testnet.arcscan.app"],
      });
      const arcWallet = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const arcPublic = createPublicClient({ chain: arcTestnet, transport: http() });
      const mintHash = await arcWallet.writeContract({
        address: ARC_MESSAGE_TRANSMITTER,
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attestation.message as `0x${string}`, attestation.attestation as `0x${string}`],
        account: address as `0x${string}`,
      });
      await arcPublic.waitForTransactionReceipt({ hash: mintHash });
      setMintTxHash(mintHash);
      setStep("done");
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
    minting: "Minting USDC on Arc Testnet...",
  };

  return (
    <div style={{ maxWidth: 460, width: "100%" }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "0.6rem 0.8rem" }}>
          <p style={{ fontSize: 12, color: "#93c5fd", margin: 0 }}>Real CCTP V2 bridge — burns USDC on source chain, mints native USDC on Arc via Circle's attestation service.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>From</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(Object.keys(SOURCE_CHAINS) as SourceChainKey[]).map((key) => (
              <button key={key} onClick={() => setSourceKey(key)} disabled={isLoading}
                style={{ flex: "1 1 30%", padding: "0.6rem", borderRadius: 8, border: sourceKey === key ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.08)", background: sourceKey === key ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: sourceKey === key ? "#60a5fa" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {key}
              </button>
            ))}
          </div>
        </div>

       <div style={{ display: "flex", justifyContent: "center" }}>
  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "0.75rem 1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 220 }}>
    <div style={{ fontSize: 13, color: "#94a3b8" }}>{sourceKey}</div>
    <div style={{ color: "#3b82f6", fontSize: 20 }}>↓</div>
    <div style={{ fontSize: 13, color: "#94a3b8" }}>Arc Testnet</div>
  </div>
</div>

<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
  <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 10, padding: "0.7rem 0.6rem", textAlign: "center" }}>
    <div style={{ fontSize: 9, color: "#60a5fa", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 3 }}>EST. TIME</div>
    <div style={{ fontSize: 13, color: "#93c5fd", fontWeight: 800 }}>~20 sec</div>
  </div>
  <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "0.7rem 0.6rem", textAlign: "center" }}>
    <div style={{ fontSize: 9, color: "#fbbf24", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 3 }}>MAX FEE</div>
    <div style={{ fontSize: 13, color: "#fcd34d", fontWeight: 800 }}>0.0005 USDC</div>
  </div>
  <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.7rem 0.6rem", textAlign: "center" }}>
    <div style={{ fontSize: 9, color: "#34d399", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 3 }}>YOU RECEIVE</div>
    <div style={{ fontSize: 13, color: "#6ee7b7", fontWeight: 800 }}>Native USDC</div>
  </div>
</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount</label>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <input type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
            <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>USDC</span>
          </div>
        </div>

        {isLoading && (
          <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
            <p style={{ fontSize: 13, color: "#93c5fd", margin: 0 }}>{stepLabels[step]}</p>
          </div>
        )}

        {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

        {burnTxHash && (
          <a href={`${source.chain.blockExplorers?.default.url}/tx/${burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#60a5fa" }}>
            Burn Tx on {sourceKey} ↗
          </a>
        )}
        {mintTxHash && (
          <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "1rem" }}>
            <p style={{ color: "#6ee7b7", fontWeight: 600, marginBottom: 6 }}>Bridge complete!</p>
            <a href={`https://testnet.arcscan.app/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View mint on Arcscan ↗</a>
          </div>
        )}

        <button onClick={step === "error" ? () => { setStep("idle"); setErrorMsg(null); } : doBridge}
          disabled={isLoading || step === "done"}
          style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading || step === "done" ? "not-allowed" : "pointer", opacity: isLoading || step === "done" ? 0.6 : 1, boxShadow: "0 0 24px rgba(59,130,246,0.3)" }}>
          {step === "idle" && "Bridge to Arc"}
          {isLoading && "Processing..."}
          {step === "done" && "Done!"}
          {step === "error" && "Try Again"}
        </button>

        {step === "done" && (
          <button onClick={() => { setStep("idle"); setBurnTxHash(null); setMintTxHash(null); setAmount(""); }}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            New Bridge
          </button>
        )}

        <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "0.6rem 0.875rem" }}>
          <p style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5, margin: 0 }}>
            Requires ETH on {sourceKey} for gas, and USDC to bridge. Get test tokens from{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>faucet.circle.com</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
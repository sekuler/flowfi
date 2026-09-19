import { useState, useEffect, useMemo } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, parseUnits } from "viem";
import type { EIP1193Provider, Chain } from "viem";
import { mainnet, base, arbitrum, optimism, polygon, avalanche } from "viem/chains";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX, USDC_ERC20_DECIMALS } from "../chains";

// Native Circle CCTP V2 bridge into Arc Mainnet -- burn on the source
// chain, Circle's Iris attestation service signs it, mint native USDC on
// Arc. No FlowFi contract, no pool, no FlowFi-held funds at any point --
// both the burn and the mint are signed by the user's own connected
// wallet. This is the alternative to routing through LI.FI: for a plain
// USDC transfer specifically, going directly through Circle's own
// protocol is the "native" path (what CCTP was built for), while LI.FI
// stays the path for any other token or a swap+bridge in one step.
//
// V2 vs V1 matters here and is a documented footgun: V1's depositForBurn
// selector (0x6fd3504e) silently reverts with no error data against a V2
// TokenMessenger. V2 adds three parameters -- destinationCaller, maxFee,
// minFinalityThreshold -- confirmed against Circle's own CCTP V2 message
// format docs and a real integration writeup for Arc specifically
// (circlefin/arc-node#110, #127). Arc-bound burns must use
// minFinalityThreshold 2000: Arc doesn't support Fast Transfer (1000) as
// a source, only the Standard/finalized tier -- using 1000 risks the
// burn being rejected by Iris.
//
// Contract addresses: TokenMessengerV2 and MessageTransmitterV2 are
// deployed at the same address across every CCTP V2-supported EVM chain
// via a consistent CREATE2 factory (standard Circle deployment pattern) --
// confirmed for Arc specifically via Arc's own docs (docs.arc.io). Domain
// IDs are Circle's own stable, documented CCTP domain numbering.
const CCTP_TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const;
const CCTP_MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;
const ARC_DOMAIN = 26;
const IRIS_API = "https://iris-api.circle.com";

interface SourceChain {
  key: string;
  name: string;
  chain: Chain;
  domain: number;
  usdc: `0x${string}`;
}

const SOURCE_CHAINS: SourceChain[] = [
  { key: "ethereum", name: "Ethereum", chain: mainnet, domain: 0, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { key: "avalanche", name: "Avalanche", chain: avalanche, domain: 1, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
  { key: "optimism", name: "Optimism", chain: optimism, domain: 2, usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { key: "arbitrum", name: "Arbitrum", chain: arbitrum, domain: 3, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  { key: "base", name: "Base", chain: base, domain: 6, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { key: "polygon", name: "Polygon", chain: polygon, domain: 7, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
];

const ERC20_APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
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
  outputs: [{ name: "nonce", type: "uint64" }],
}] as const;
const RECEIVE_MESSAGE_ABI = [{
  type: "function", name: "receiveMessage", stateMutability: "nonpayable",
  inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
  outputs: [{ type: "bool" }],
}] as const;

function addressToBytes32(addr: string): `0x${string}` {
  return `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}` as `0x${string}`;
}

type Step = "idle" | "approving" | "burning" | "waiting-attestation" | "minting" | "done" | "error";

export default function NativeCctpBridge({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const [sourceIdx, setSourceIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [rotatingIdx, setRotatingIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRotatingIdx((i) => (i + 1) % SOURCE_CHAINS.length), 2200);
    return () => clearInterval(interval);
  }, []);

  const source = SOURCE_CHAINS[sourceIdx];

  async function fetchMaxFee(amountRaw: bigint): Promise<bigint> {
    try {
      const res = await fetch(`${IRIS_API}/v2/burn/USDC/fees/${source.domain}/${ARC_DOMAIN}`);
      const data = await res.json();
      const bps = Number(data?.[0]?.minimumFee ?? 100); // fallback: 1% (100 bps) if the API shape changes
      const fee = (amountRaw * BigInt(Math.ceil(bps * 1.2))) / 10000n; // +20% buffer per Circle's own guidance
      return fee > 0n ? fee : 1n;
    } catch {
      return (amountRaw * 150n) / 10000n; // 1.5% conservative fallback if the fee API is unreachable
    }
  }

  async function pollAttestation(txHash: string): Promise<{ message: string; attestation: string }> {
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${IRIS_API}/v2/messages/${source.domain}?transactionHash=${txHash}`);
      const data = await res.json();
      const msg = data?.messages?.[0];
      if (msg?.status === "complete" && msg.message && msg.attestation) {
        return { message: msg.message, attestation: msg.attestation };
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("Attestation is taking longer than expected. Your burn is confirmed on-chain — check back shortly, the mint can be completed once Circle's attestation is ready.");
  }

  async function run() {
    if (!provider || !amount.trim()) return;
    setError(null);
    try {
      const walletClient = createWalletClient({ account: address as `0x${string}`, chain: source.chain, transport: custom(provider) });
      const publicClient = createPublicClient({ chain: source.chain, transport: http() });

      const currentChainId = await provider.request({ method: "eth_chainId" });
      const wantedHex = `0x${source.chain.id.toString(16)}`;
      if ((currentChainId as string).toLowerCase() !== wantedHex.toLowerCase()) {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wantedHex }] });
      }

      const amountRaw = parseUnits(amount.trim(), USDC_ERC20_DECIMALS);
      const maxFee = await fetchMaxFee(amountRaw);

      setStep("approving");
      const approveHash = await walletClient.sendTransaction({
        to: source.usdc,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, amountRaw] }),
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStep("burning");
      const mintRecipient = addressToBytes32(address);
      const burnHash = await walletClient.sendTransaction({
        to: CCTP_TOKEN_MESSENGER_V2,
        data: encodeFunctionData({
          abi: DEPOSIT_FOR_BURN_ABI,
          functionName: "depositForBurn",
          args: [amountRaw, ARC_DOMAIN, mintRecipient, source.usdc, `0x${"0".repeat(64)}`, maxFee, 2000],
        }),
      });
      setBurnTxHash(burnHash);
      await publicClient.waitForTransactionReceipt({ hash: burnHash });

      setStep("waiting-attestation");
      const { message, attestation } = await pollAttestation(burnHash);

      const arcWalletClient = createWalletClient({ account: address as `0x${string}`, chain: arcMainnet, transport: custom(provider) });
      const arcPublicClient = createPublicClient({ chain: arcMainnet, transport: http() });

      const arcChainId = await provider.request({ method: "eth_chainId" });
      if ((arcChainId as string).toLowerCase() !== ARC_MAINNET_CHAIN_ID_HEX.toLowerCase()) {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX }] });
        } catch (e: unknown) {
          const err = e as { code?: number };
          if (err.code === 4902) {
            await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }] });
          }
        }
      }

      setStep("minting");
      const mintHash = await arcWalletClient.sendTransaction({
        to: CCTP_MESSAGE_TRANSMITTER_V2,
        data: encodeFunctionData({ abi: RECEIVE_MESSAGE_ABI, functionName: "receiveMessage", args: [message as `0x${string}`, attestation as `0x${string}`] }),
      });
      setMintTxHash(mintHash);
      await arcPublicClient.waitForTransactionReceipt({ hash: mintHash });
      setStep("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage || err.message || "Something went wrong.");
      setStep("error");
    }
  }

  const stepLabel = useMemo(() => ({
    idle: "", approving: "Approving USDC...", burning: "Burning on source chain...",
    "waiting-attestation": "Waiting for Circle's attestation (usually under a minute)...",
    minting: "Minting native USDC on Arc...", done: "Complete!", error: "Failed",
  }[step]), [step]);

  const busy = step !== "idle" && step !== "done" && step !== "error";

  return (
    <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem" }}>
      <div style={{ fontSize: 11, color: "#6D5EF7", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>ARC MAINNET · CIRCLE CCTP V2</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 4px" }}>
        Bridge to Arc from{" "}
        <span key={rotatingIdx} className="flowfi-mono" style={{ color: "#6D5EF7", display: "inline-block" }}>{SOURCE_CHAINS[rotatingIdx].name}</span>
      </h2>
      <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>
        Bridge USDC to Arc natively with Circle CCTP V2 — burn on the source chain, mint native USDC on Arc. Any other token or chain routes through LI.FI's Swap.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>From</label>
          <select value={sourceIdx} onChange={(e) => setSourceIdx(Number(e.target.value))} disabled={busy}
            style={{ width: "100%", padding: "0.7rem 0.9rem", borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 14, marginTop: 4, background: "#F5F3FF" }}>
            {SOURCE_CHAINS.map((c, i) => <option key={c.key} value={i}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>Amount (USDC)</label>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} placeholder="0.00"
            style={{ width: "100%", padding: "0.7rem 0.9rem", borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 16, marginTop: 4, boxSizing: "border-box" }} />
        </div>

        <div style={{ background: "#F5F3FF", borderRadius: 12, padding: "0.75rem 1rem", fontSize: 11.5, color: "#4B5563" }}>
          <strong>Multi-step bridge.</strong> You'll sign an approve + burn on {source.name}, then a mint on Arc once Circle attests the transfer. You'll need a little gas on Arc for the mint step (Arc gas is USDC).
        </div>

        {error && <div style={{ background: "rgba(239,68,68,0.1)", color: "#DC2626", borderRadius: 12, padding: "0.75rem 1rem", fontSize: 12.5 }}>{error}</div>}

        {step !== "idle" && (
          <div style={{ background: "#EDE9FE", borderRadius: 12, padding: "0.75rem 1rem", fontSize: 12.5, color: "#6D5EF7", fontWeight: 600 }}>
            {stepLabel}
            {burnTxHash && <div style={{ marginTop: 4 }}><a href={`${source.name === "Ethereum" ? "https://etherscan.io" : "#"}/tx/${burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7" }}>Burn tx ↗</a></div>}
            {mintTxHash && <div style={{ marginTop: 2 }}><a href={`https://arc.etherscan.io/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7" }}>Mint tx ↗</a></div>}
          </div>
        )}

        <button onClick={run} disabled={busy || !amount.trim() || !provider}
          style={{ width: "100%", padding: "0.9rem", borderRadius: 14, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 15, fontWeight: 700, cursor: busy || !amount.trim() ? "not-allowed" : "pointer", opacity: busy || !amount.trim() ? 0.6 : 1 }}>
          {busy ? stepLabel : step === "done" ? "Bridge again" : "Bridge USDC"}
        </button>
      </div>
    </div>
  );
}

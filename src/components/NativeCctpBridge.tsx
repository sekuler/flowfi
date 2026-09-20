import { useState, useMemo } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, parseUnits } from "viem";
import type { EIP1193Provider, Chain } from "viem";
import {
  mainnet, base, arbitrum, optimism, polygon, avalanche,
  unichain, linea, sonic, worldchain, monad, sei, xdc, hyperEvm, ink, plume, morph, codex,
} from "viem/chains";
import { Check } from "lucide-react";
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
// IDs cross-checked 2026-09-20 against Circle's own official domain table
// (developers.circle.com/cctp/concepts/supported-chains-and-domains) --
// every domain number below matches that source exactly. Chain IDs and
// RPC endpoints come from viem's own built-in chain registry (not
// hand-typed), so wallet_switchEthereumChain/wallet_addEthereumChain get
// real, working values. Two exclusions from an earlier candidate list:
// EDGE (its CCTP MessageTransmitterV2 address isn't independently
// confirmed anywhere yet -- can't safely build the mint step without it)
// and Pharos (no chain ID/RPC available in viem's registry to switch a
// wallet to it). Note: Plume's chain ID here is 98865 per viem's
// registry, not 98866 -- flagged as a discrepancy against an earlier
// candidate list, viem's independently-maintained registry trusted here.
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
  fastTransfer: boolean;
  logo: string; // DefiLlama's public chain-icon CDN; falls back to a letter badge on load failure
}

const LLAMA_ICON = (key: string) => `https://icons.llamao.fi/icons/chains/rsz_${key}.jpg`;

export const SOURCE_CHAINS: SourceChain[] = [
  { key: "ethereum", name: "Ethereum", chain: mainnet, domain: 0, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", fastTransfer: true, logo: LLAMA_ICON("ethereum") },
  { key: "avalanche", name: "Avalanche", chain: avalanche, domain: 1, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", fastTransfer: false, logo: LLAMA_ICON("avalanche") },
  { key: "optimism", name: "Optimism", chain: optimism, domain: 2, usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", fastTransfer: true, logo: LLAMA_ICON("optimism") },
  { key: "arbitrum", name: "Arbitrum", chain: arbitrum, domain: 3, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", fastTransfer: true, logo: LLAMA_ICON("arbitrum") },
  { key: "base", name: "Base", chain: base, domain: 6, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", fastTransfer: true, logo: LLAMA_ICON("base") },
  { key: "polygon", name: "Polygon", chain: polygon, domain: 7, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", fastTransfer: false, logo: LLAMA_ICON("polygon") },
  { key: "unichain", name: "Unichain", chain: unichain, domain: 10, usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", fastTransfer: true, logo: LLAMA_ICON("unichain") },
  { key: "linea", name: "Linea", chain: linea, domain: 11, usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", fastTransfer: true, logo: LLAMA_ICON("linea") },
  { key: "codex", name: "Codex", chain: codex, domain: 12, usdc: "0xd996633a415985DBd7D6D12f4A4343E31f5037cf", fastTransfer: true, logo: LLAMA_ICON("codex") },
  { key: "sonic", name: "Sonic", chain: sonic, domain: 13, usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", fastTransfer: false, logo: LLAMA_ICON("sonic") },
  { key: "worldchain", name: "World Chain", chain: worldchain, domain: 14, usdc: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1", fastTransfer: true, logo: LLAMA_ICON("world-chain") },
  { key: "monad", name: "Monad", chain: monad, domain: 15, usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", fastTransfer: false, logo: LLAMA_ICON("monad") },
  { key: "sei", name: "Sei", chain: sei, domain: 16, usdc: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", fastTransfer: false, logo: LLAMA_ICON("sei") },
  { key: "xdc", name: "XDC", chain: xdc, domain: 18, usdc: "0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1", fastTransfer: false, logo: LLAMA_ICON("xdc") },
  { key: "hyperevm", name: "HyperEVM", chain: hyperEvm, domain: 19, usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", fastTransfer: false, logo: LLAMA_ICON("hyperliquid") },
  { key: "ink", name: "Ink", chain: ink, domain: 21, usdc: "0x2D270e6886d130D724215A266106e6832161EAEd", fastTransfer: true, logo: LLAMA_ICON("ink") },
  { key: "plume", name: "Plume", chain: plume, domain: 22, usdc: "0x222365EF19F7947e5484218551B56bb3965Aa7aF", fastTransfer: true, logo: LLAMA_ICON("plume") },
  { key: "morph", name: "Morph", chain: morph, domain: 30, usdc: "0xCfb1186F4e93D60E60a8bDd997427D1F33bc372B", fastTransfer: true, logo: LLAMA_ICON("morph") },
];

const CHAIN_COLORS: Record<string, string> = {
  ethereum: "#627EEA", avalanche: "#E84142", optimism: "#FF0420",
  arbitrum: "#28A0F0", base: "#0052FF", polygon: "#8247E5",
  unichain: "#FF37C7", linea: "#61DFFF", codex: "#6D5EF7", sonic: "#FE9A4D",
  worldchain: "#111827", monad: "#8B5CF6", sei: "#8B1BFF", xdc: "#F9A825",
  hyperevm: "#00D4AA", ink: "#7132F5", plume: "#FF6B4A", morph: "#5FC8FF",
};

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

// Real chain logo via DefiLlama's public icon CDN, falling back to a
// colored letter badge if that specific chain's icon isn't on their CDN
// (some very new chains, e.g. Monad, World Chain, may not have one yet) --
// purely cosmetic, so a 404 just degrades gracefully rather than breaking
// anything.
function ChainLogo({ chain, size }: { chain: SourceChain; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span style={{ width: size, height: size, borderRadius: "50%", background: CHAIN_COLORS[chain.key] ?? "#6D5EF7", color: "#fff", fontSize: size * 0.42, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {chain.name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img src={chain.logo} alt={chain.name} width={size} height={size} onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "#fff" }} />
  );
}

type Step = "idle" | "approving" | "burning" | "waiting-attestation" | "minting" | "done" | "error";

export default function NativeCctpBridge({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const [sourceIdx, setSourceIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [chainMenuOpen, setChainMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);

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
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wantedHex }] });
        } catch (e: unknown) {
          const err = e as { code?: number };
          if (err.code === 4902) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: wantedHex,
                chainName: source.chain.name,
                nativeCurrency: source.chain.nativeCurrency,
                rpcUrls: [source.chain.rpcUrls.default.http[0]],
                blockExplorerUrls: source.chain.blockExplorers?.default?.url ? [source.chain.blockExplorers.default.url] : [],
              }],
            });
          } else {
            throw e;
          }
        }
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
    idle: "", approving: "Approving USDC...", burning: "Sending from source chain...",
    "waiting-attestation": "Waiting for Circle to confirm (usually under a minute)...",
    minting: "Receiving native USDC on Arc...", done: "Complete!", error: "Failed",
  }[step]), [step]);

  const busy = step !== "idle" && step !== "done" && step !== "error";

  return (
    <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, padding: "1.4rem 1rem", marginBottom: 20, background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", borderRadius: 16 }}>
        {[
          { key: "burn", label: "Send", sub: "Burned on the source chain", num: 1, active: step === "approving" || step === "burning", complete: step === "waiting-attestation" || step === "minting" || step === "done" },
          { key: "attest", label: "Confirm", sub: "Circle attests the burn", num: 2, active: step === "waiting-attestation", complete: step === "minting" || step === "done" },
          { key: "mint", label: "Receive", sub: "USDC minted on Arc", num: 3, active: step === "minting", complete: step === "done" },
        ].map((s, i, arr) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", flex: i < arr.length - 1 ? 1 : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 72 }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                background: s.complete || s.active ? "#6D5EF7" : "#ffffff",
                border: s.complete || s.active ? "none" : "1.5px solid #D4C9FA",
                boxShadow: s.active ? "0 0 0 5px rgba(109,94,247,0.15)" : "none",
                transition: "all 0.3s",
              }}>
                {s.complete ? <Check size={17} color="#fff" /> : <span style={{ fontSize: 15, fontWeight: 800, color: s.active ? "#fff" : "#9CA3AF" }}>{s.num}</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: s.complete || s.active ? "#6D5EF7" : "#6B7280" }}>{s.label}</div>
              <div style={{ fontSize: 9.5, color: "#9CA3AF", textAlign: "center" }}>{s.sub}</div>
            </div>
            {i < arr.length - 1 && (
              <div style={{ flex: 1, height: 2, background: arr[i].complete ? "#6D5EF7" : "#D4C9FA", margin: "0 4px 22px", transition: "background 0.3s" }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ position: "relative" }}>
          <label style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>From</label>
          <button type="button" onClick={() => !busy && setChainMenuOpen((o) => !o)} disabled={busy}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.9rem", borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 14, marginTop: 4, background: "#F5F3FF", cursor: busy ? "not-allowed" : "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ChainLogo chain={source} size={28} />
              <span style={{ fontWeight: 700, color: "#111827" }}>{source.name}</span>
            </span>
            <span style={{ color: "#9CA3AF" }}>{chainMenuOpen ? "▲" : "▼"}</span>
          </button>
          {chainMenuOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, boxShadow: "0 12px 32px rgba(17,24,39,0.12)", zIndex: 10, overflow: "hidden", maxHeight: 340, overflowY: "auto" }}>
              {SOURCE_CHAINS.map((c, i) => (
                <button key={c.key} type="button" onClick={() => { setSourceIdx(i); setChainMenuOpen(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0.7rem 0.9rem", border: "none", borderBottom: "1px solid #F5F3FF", background: i === sourceIdx ? "#F5F3FF" : "#fff", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ChainLogo chain={c} size={26} />
                    <span style={{ fontSize: 13.5, color: "#111827", fontWeight: i === sourceIdx ? 700 : 500 }}>{c.name}</span>
                  </span>
                  {c.fastTransfer && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#16A34A", background: "rgba(34,197,94,0.1)", padding: "2px 7px", borderRadius: 999 }}>FAST</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>You send (USDC)</label>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} placeholder="0.00"
            style={{ width: "100%", padding: "0.7rem 0.9rem", borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 16, marginTop: 4, boxSizing: "border-box" }} />
        </div>

        <div style={{ background: "#F5F3FF", borderRadius: 12, padding: "0.75rem 1rem", fontSize: 11.5, color: "#4B5563" }}>
          <strong>Heads up:</strong> you'll sign twice on {source.name} (approve, then send). Once Circle confirms, the last step runs on Arc and costs a small amount of USDC for gas.
        </div>

        {error && <div style={{ background: "rgba(239,68,68,0.1)", color: "#DC2626", borderRadius: 12, padding: "0.75rem 1rem", fontSize: 12.5 }}>{error}</div>}

        {step !== "idle" && (
          <div style={{ background: "#EDE9FE", borderRadius: 12, padding: "0.75rem 1rem", fontSize: 12.5, color: "#6D5EF7", fontWeight: 600 }}>
            {stepLabel}
            {burnTxHash && <div style={{ marginTop: 4 }}><a href={`${source.chain.blockExplorers?.default?.url ?? "#"}/tx/${burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7" }}>Burn tx ↗</a></div>}
            {mintTxHash && <div style={{ marginTop: 2 }}><a href={`https://arc.etherscan.io/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7" }}>Mint tx ↗</a></div>}
          </div>
        )}

        <button onClick={run} disabled={busy || !amount.trim() || !provider}
          style={{ width: "100%", padding: "0.9rem", borderRadius: 14, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 15, fontWeight: 700, cursor: busy || !amount.trim() ? "not-allowed" : "pointer", opacity: busy || !amount.trim() ? 0.6 : 1 }}>
          {busy ? stepLabel : step === "done" ? "Send again" : "Send to Arc"}
        </button>
      </div>
    </div>
  );
}

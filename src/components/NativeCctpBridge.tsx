import { useState, useMemo, useEffect } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, parseUnits, formatUnits } from "viem";
import type { EIP1193Provider, Chain } from "viem";
import {
  mainnet, base, arbitrum, optimism, polygon, avalanche,
  unichain, linea, sonic, worldchain, monad, sei, xdc, hyperEvm, ink, plume, morph, codex,
} from "viem/chains";
import { Check, ArrowRight, ArrowLeft, ChevronDown, X } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX, USDC_ERC20_DECIMALS } from "../chains";
import { USDC_LOGO } from "./tokenLogos";

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

const ERC20_BALANCE_ABI = [{
  type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ type: "uint256" }],
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

// Arc's logo comes from LI.FI's public chain list (the app already talks to li.quest), looked up once and cached.
// If that lookup fails, a gradient badge is shown instead, so nothing breaks.
let arcLogoPromise: Promise<string | null> | null = null;
function loadArcLogo(): Promise<string | null> {
  if (!arcLogoPromise) {
    arcLogoPromise = fetch("https://li.quest/v1/chains?chainTypes=EVM")
      .then((r) => r.json())
      .then((d) => {
        const c = (d?.chains ?? []).find((x: { id?: number; logoURI?: string }) => x.id === arcMainnet.id);
        return (c?.logoURI as string | undefined) ?? null;
      })
      .catch(() => null);
  }
  return arcLogoPromise;
}

function ArcLogo({ size }: { size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadArcLogo().then((u) => { if (!cancelled) setSrc(u); });
    return () => { cancelled = true; };
  }, []);
  if (!src || failed) {
    return (
      <span style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "#fff", fontSize: size * 0.42, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>A</span>
    );
  }
  return (
    <img src={src} alt="Arc" width={size} height={size} onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "#fff" }} />
  );
}

function UsdcLogo({ size }: { size: number }) {
  return <img src={USDC_LOGO} alt="USDC" width={size} height={size} style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0 }} />;
}

type Step = "idle" | "approving" | "burning" | "waiting-attestation" | "minting" | "done" | "error";

const PENDING_KEY = "flowfi-cctp-pending";

function fmt(n: number, max = 2) {
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}

export default function NativeCctpBridge({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const [view, setView] = useState<"form" | "review">("form");
  const [sourceIdx, setSourceIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [balances, setBalances] = useState<Record<string, string | null>>({});
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [burnSourceIdx, setBurnSourceIdx] = useState<number | null>(null);

  const source = SOURCE_CHAINS[sourceIdx];
  const burnSource = SOURCE_CHAINS[burnSourceIdx ?? sourceIdx];

  function savePending(hash: string, idx: number, amt: string) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ hash, sourceIdx: idx, address, amount: amt })); } catch { /* ignore */ }
  }
  function clearPending() {
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  }

  // An earlier transfer whose burn went through but whose mint on Arc never finished.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { hash?: string; sourceIdx?: number; address?: string; amount?: string };
      if (!p.hash || typeof p.sourceIdx !== "number" || !SOURCE_CHAINS[p.sourceIdx]) return;
      if (p.address?.toLowerCase() !== address.toLowerCase()) return;
      setBurnTxHash(p.hash);
      setBurnSourceIdx(p.sourceIdx);
      setSourceIdx(p.sourceIdx);
      setAmount(p.amount ?? "");
      setStep("error");
      setError("You have an unfinished transfer: the burn is confirmed, but the USDC hasn't been minted on Arc yet.");
      setView("review");
    } catch { /* ignore */ }
  }, [address]);

  async function fetchBalance(c: SourceChain): Promise<string | null> {
    try {
      const pc = createPublicClient({ chain: c.chain, transport: http() });
      const raw = await pc.readContract({ address: c.usdc, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [address as `0x${string}`] });
      return formatUnits(raw as bigint, USDC_ERC20_DECIMALS);
    } catch {
      return null;
    }
  }

  // Balance on the selected chain (for MAX and the insufficient-balance check).
  useEffect(() => {
    let cancelled = false;
    fetchBalance(source).then((b) => { if (!cancelled) setBalances((m) => ({ ...m, [source.key]: b })); });
    return () => { cancelled = true; };
  }, [source, address, step === "done"]);

  // Balances on every chain, only while the network picker is open.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    SOURCE_CHAINS.forEach((c) => {
      fetchBalance(c).then((b) => { if (!cancelled) setBalances((m) => ({ ...m, [c.key]: b })); });
    });
    return () => { cancelled = true; };
  }, [pickerOpen]);

  // Circle's published fee for the Standard tier on this route (display only; hidden if the API shape differs).
  useEffect(() => {
    let cancelled = false;
    setFeeBps(null);
    fetch(`${IRIS_API}/v2/burn/USDC/fees/${source.domain}/${ARC_DOMAIN}`)
      .then((r) => r.json())
      .then((data) => {
        const std = Array.isArray(data) ? data.find((d: { finalityThreshold?: number }) => d.finalityThreshold === 2000) : null;
        const v = Number(std?.minimumFee);
        if (!cancelled && std && Number.isFinite(v)) setFeeBps(v);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [source]);

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

  async function pollAttestation(txHash: string, domain: number): Promise<{ message: string; attestation: string }> {
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${IRIS_API}/v2/messages/${domain}?transactionHash=${txHash}`);
      const data = await res.json();
      const msg = data?.messages?.[0];
      if (msg?.status === "complete" && msg.message && msg.attestation) {
        return { message: msg.message, attestation: msg.attestation };
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("Attestation is taking longer than expected. Your burn is confirmed on-chain, so don't send again. Use Resume to finish the transfer once Circle's attestation is ready.");
  }

  // run() starts a new transfer. run({ hash }) resumes one whose burn is already confirmed:
  // it skips approve + burn (so nothing is burned twice) and only waits for the attestation and mints on Arc.
  async function run(resume?: { hash: string }) {
    if (!provider) return;
    if (!resume && !amount.trim()) return;
    setError(null);
    try {
      const src = resume ? burnSource : source;
      let burnHash: string;

      if (resume) {
        burnHash = resume.hash;
      } else {
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
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status === "reverted") throw new Error("The approval transaction reverted. Nothing was sent.");

        setStep("burning");
        const mintRecipient = addressToBytes32(address);
        burnHash = await walletClient.sendTransaction({
          to: CCTP_TOKEN_MESSENGER_V2,
          data: encodeFunctionData({
            abi: DEPOSIT_FOR_BURN_ABI,
            functionName: "depositForBurn",
            args: [amountRaw, ARC_DOMAIN, mintRecipient, source.usdc, `0x${"0".repeat(64)}`, maxFee, 2000],
          }),
        });
        setBurnTxHash(burnHash);
        setBurnSourceIdx(sourceIdx);
        savePending(burnHash, sourceIdx, amount.trim());
        const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnHash as `0x${string}` });
        if (burnReceipt.status === "reverted") {
          clearPending();
          setBurnTxHash(null);
          setBurnSourceIdx(null);
          throw new Error("The burn transaction reverted on the source chain. No USDC was burned.");
        }
      }

      setStep("waiting-attestation");
      const { message, attestation } = await pollAttestation(burnHash, src.domain);

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
      const mintReceipt = await arcPublicClient.waitForTransactionReceipt({ hash: mintHash });
      if (mintReceipt.status === "reverted") throw new Error("The mint on Arc reverted. If this transfer was already completed, use Dismiss below.");
      clearPending();
      setStep("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage || err.message || "Something went wrong.");
      setStep("error");
    }
  }

  const stepLabel = useMemo(() => ({
    idle: "", approving: "Approving USDC...", burning: "Sending from source chain...",
    "waiting-attestation": "Waiting for Circle to confirm the transfer...",
    minting: "Receiving native USDC on Arc...", done: "Complete!", error: "Failed",
  }[step]), [step]);

  const busy = step !== "idle" && step !== "done" && step !== "error";
  const unfinished = step === "error" && !!burnTxHash;
  const locked = busy || unfinished;

  function resetForm() {
    setStep("idle"); setAmount(""); setBurnTxHash(null); setMintTxHash(null); setBurnSourceIdx(null); setError(null); setView("form");
  }

  const balance = balances[source.key];
  const balNum = balance != null ? Number(balance) : null;
  const amt = parseFloat(amount);
  const validAmt = Number.isFinite(amt) && amt > 0;
  const insufficient = validAmt && balNum !== null && amt > balNum;
  const receive = validAmt && feeBps !== null ? amt * (1 - feeBps / 10000) : null;
  const feeText = feeBps === null ? null : feeBps === 0 ? "Free" : `${(feeBps / 100).toFixed(2)}%`;
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const steps = [
    { key: "burn", label: "Send", num: 1, active: step === "approving" || step === "burning", complete: step === "waiting-attestation" || step === "minting" || step === "done" || unfinished },
    { key: "attest", label: "Confirm", num: 2, active: step === "waiting-attestation", complete: step === "minting" || step === "done" },
    { key: "mint", label: "Receive", num: 3, active: step === "minting", complete: step === "done" },
  ];

  const chip = step === "done"
    ? { text: "Success", bg: "#DCF5E3", fg: "#15803D", border: "#22C55E" }
    : unfinished
      ? { text: "Action needed", bg: "#FEF6D8", fg: "#A16207", border: "#EAB308" }
      : step === "error"
        ? { text: "Failed", bg: "#FDE8E8", fg: "#B91C1C", border: "#EF4444" }
        : { text: "Pending", bg: "#FEF6D8", fg: "#A16207", border: "#EAB308" };

  // CTA per view / state
  let ctaLabel = "";
  let ctaEnabled = false;
  let ctaAction: () => void = () => {};
  if (view === "form") {
    ctaLabel = !provider ? "Connect wallet" : !validAmt ? "Enter an amount" : insufficient ? "Insufficient USDC balance" : "Review transfer";
    ctaEnabled = !!provider && validAmt && !insufficient;
    ctaAction = () => setView("review");
  } else if (busy) {
    ctaLabel = "Processing...";
  } else if (step === "done") {
    ctaLabel = "Send another"; ctaEnabled = true; ctaAction = resetForm;
  } else if (unfinished && burnTxHash) {
    ctaLabel = "Resume and finish on Arc"; ctaEnabled = !!provider; ctaAction = () => run({ hash: burnTxHash });
  } else if (step === "error") {
    ctaLabel = "Try again"; ctaEnabled = !!provider; ctaAction = () => run();
  } else {
    ctaLabel = "Confirm and send"; ctaEnabled = !!provider; ctaAction = () => run();
  }

  const paneStyle = { background: "#F8F7FF", borderRadius: 20, padding: "14px 12px", display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 8, minWidth: 0 };
  const labelStyle = { fontSize: 11, color: "#9CA3AF", fontWeight: 600, letterSpacing: 0.3 };

  const formRows: { k: string; v: string; good?: boolean }[] = [
    { k: "Route", v: "Circle CCTP V2" },
    { k: "Speed", v: "Standard" },
    ...(feeText ? [{ k: "Circle fee", v: feeText, good: feeBps === 0 }] : []),
    { k: "You receive", v: receive !== null ? `≈ ${fmt(receive, 6)} USDC` : "—" },
    { k: "Gas on Arc", v: "Paid in USDC" },
  ];
  const reviewRows: { k: string; v: string; good?: boolean }[] = [
    { k: "Recipient", v: `${shortAddr} on Arc` },
    { k: "Route", v: "Circle CCTP V2" },
    { k: "Speed", v: "Standard" },
    ...(feeText ? [{ k: "Circle fee", v: feeText, good: feeBps === 0 }] : []),
    { k: "Signatures", v: `2 on ${source.name}, 1 on Arc` },
    { k: "Gas on Arc", v: "Paid in USDC" },
  ];

  const q = search.trim().toLowerCase();
  const pickerList = SOURCE_CHAINS
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => (Number(balances[b.c.key] ?? 0) - Number(balances[a.c.key] ?? 0)) || a.i - b.i);

  function renderRows(rows: { k: string; v: string; good?: boolean }[]) {
    return (
      <div style={{ marginTop: 10, border: "1px solid #F0ECFF", borderRadius: 18, padding: "6px 14px" }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < rows.length - 1 ? "1px solid #F5F3FF" : "none", fontSize: 12.5 }}>
            <span style={{ color: "#6B7280" }}>{r.k}</span>
            <span style={{ color: r.good ? "#16A34A" : "#111827", fontWeight: 600, textAlign: "right" }}>{r.v}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#ffffff", border: "1px solid rgba(212,201,250,0.7)", borderRadius: 28, padding: "1.1rem", boxShadow: "0 24px 60px -16px rgba(109,94,247,0.28), 0 2px 6px rgba(17,24,39,0.04)" }}>
      <style>{`@keyframes ffspin { to { transform: rotate(360deg); } } .ff-amount, .ff-amount:focus, .ff-amount:focus-visible { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; } .ff-amount::placeholder { color: #C4C0DC; }`}</style>

      {view === "form" && (
        <>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={() => { setSearch(""); setPickerOpen(true); }}
              style={{ ...paneStyle, border: "none", cursor: "pointer" }}>
              <span style={labelStyle}>FROM</span>
              <ChainLogo chain={source} size={40} />
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 700, color: "#111827" }}>
                {source.name}<ChevronDown size={14} color="#9CA3AF" />
              </span>
            </button>

            <div style={paneStyle}>
              <span style={labelStyle}>TO</span>
              <ArcLogo size={40} />
              <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Arc</span>
            </div>

            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 34, height: 34, borderRadius: "50%", background: "#fff", border: "3px solid #fff", boxShadow: "0 2px 8px rgba(109,94,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <ArrowRight size={16} color="#6D5EF7" />
            </div>
          </div>

          <div style={{ marginTop: 10, background: "#F8F7FF", borderRadius: 20, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={labelStyle}>YOU SEND</span>
              {balNum !== null && (
                <span style={{ fontSize: 11.5, color: "#6B7280" }}>
                  Balance: {fmt(balNum)} USDC{" "}
                  <button type="button" onClick={() => balance && setAmount(balance)}
                    style={{ border: "none", background: "#EDE9FE", color: "#6D5EF7", fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, cursor: "pointer", marginLeft: 4 }}>MAX</button>
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input className="ff-amount" type="text" inputMode="decimal" value={amount} placeholder="0.00"
                onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }}
                style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 30, fontWeight: 700, color: "#111827", padding: 0 }} />
              <span style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 999, padding: "5px 12px 5px 6px", fontSize: 13, fontWeight: 700, color: "#111827", boxShadow: "0 1px 3px rgba(17,24,39,0.06)" }}>
                <UsdcLogo size={24} />
                USDC
              </span>
            </div>
          </div>

          {renderRows(formRows)}
        </>
      )}

      {view === "review" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <button type="button" disabled={locked} onClick={() => setView("form")}
              style={{ width: 34, height: 34, borderRadius: 12, border: "none", background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}>
              <ArrowLeft size={17} color="#4B5563" />
            </button>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>Review transfer</span>
            <span style={{ width: 34 }} />
          </div>

          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={paneStyle}>
              <span style={labelStyle}>YOU SEND</span>
              <ChainLogo chain={burnSource} size={36} />
              <span style={{ fontSize: 15, fontWeight: 800, color: "#111827", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{validAmt ? fmt(amt, 6) : amount} USDC</span>
              <span style={{ fontSize: 11.5, color: "#6B7280" }}>on {burnSource.name}</span>
            </div>
            <div style={paneStyle}>
              <span style={labelStyle}>YOU RECEIVE</span>
              <ArcLogo size={36} />
              <span style={{ fontSize: 15, fontWeight: 800, color: "#111827", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{receive !== null ? `≈ ${fmt(receive, 6)}` : "—"} USDC</span>
              <span style={{ fontSize: 11.5, color: "#6B7280" }}>on Arc</span>
            </div>
            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 34, height: 34, borderRadius: "50%", background: "#fff", border: "3px solid #fff", boxShadow: "0 2px 8px rgba(109,94,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <ArrowRight size={16} color="#6D5EF7" />
            </div>
          </div>

          {renderRows(reviewRows)}

          {step === "idle" && (
            <div style={{ marginTop: 10, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 14, padding: "10px 12px", fontSize: 11.5, color: "#92400E", lineHeight: 1.55 }}>
              Standard transfers wait for {source.name} to finalize before Circle confirms, so this isn't instant. Keep this tab open until it finishes. If you close it, you can resume later from here.
            </div>
          )}
        </>
      )}

      {view === "review" && step !== "idle" && (
        <div style={{ marginTop: 12, border: "1px solid #EDE9FE", borderRadius: 20, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            {steps.map((st, i) => (
              <div key={st.key} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : undefined }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 54 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: st.complete || st.active ? "#6D5EF7" : "#fff", border: st.complete || st.active ? "none" : "1.5px solid #D4C9FA", boxShadow: st.active ? "0 0 0 4px rgba(109,94,247,0.15)" : "none", transition: "all 0.3s" }}>
                    {st.complete ? <Check size={15} color="#fff" /> : <span style={{ fontSize: 13, fontWeight: 800, color: st.active ? "#fff" : "#9CA3AF" }}>{st.num}</span>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.complete || st.active ? "#6D5EF7" : "#9CA3AF" }}>{st.label}</span>
                </div>
                {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: st.complete ? "#6D5EF7" : "#E9E4FC", margin: "0 4px 16px", transition: "background 0.3s" }} />}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: chip.bg, color: chip.fg, border: `1px solid ${chip.border}`, borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>
              {busy && <span style={{ width: 11, height: 11, borderRadius: "50%", border: `2px solid ${chip.fg}`, borderTopColor: "transparent", animation: "ffspin 0.8s linear infinite" }} />}
              {chip.text}
            </span>
            <span style={{ fontSize: 12.5, color: step === "error" && !unfinished ? "#B91C1C" : "#4B5563", lineHeight: 1.5, wordBreak: "break-word" }}>
              {step === "error" ? error : step === "done" ? "Your USDC is now on Arc." : stepLabel}
              {unfinished && <><br />Your burn is confirmed. Use Resume below and don't start a new transfer.</>}
            </span>
          </div>

          {(burnTxHash || mintTxHash) && (
            <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12 }}>
              {burnTxHash && <a href={`${burnSource.chain.blockExplorers?.default?.url ?? "#"}/tx/${burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7", fontWeight: 600 }}>Send tx ↗</a>}
              {mintTxHash && <a href={`https://arc.etherscan.io/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7", fontWeight: 600 }}>Receive tx ↗</a>}
            </div>
          )}
        </div>
      )}

      <button onClick={ctaAction} disabled={!ctaEnabled}
        style={{ width: "100%", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.55rem 0.55rem 0.55rem 1.5rem", borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", background: ctaEnabled ? "linear-gradient(135deg,#4F46E5,#7C3AED)" : "#EEEDF5", color: ctaEnabled ? "#fff" : "#9CA3AF", fontSize: 16, fontWeight: 700, boxShadow: ctaEnabled ? "0 10px 28px rgba(109,94,247,0.4)" : "none", cursor: ctaEnabled ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
        <span>{ctaLabel}</span>
        <span style={{ width: 42, height: 42, borderRadius: 15, background: ctaEnabled ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowRight size={19} />
        </span>
      </button>

      {unfinished && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button type="button" onClick={() => { clearPending(); resetForm(); }}
            style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>
            Already finished, or don't need this? Dismiss
          </button>
        </div>
      )}

      {pickerOpen && (
        <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(17,24,39,0.45)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 24, boxShadow: "0 24px 60px rgba(17,24,39,0.25)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.1rem 1.25rem 0.6rem" }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: "#111827" }}>Select network</span>
              <button type="button" onClick={() => setPickerOpen(false)} style={{ width: 32, height: 32, borderRadius: 999, border: "none", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <X size={16} color="#4B5563" />
              </button>
            </div>
            <div style={{ padding: "0 1.25rem 0.6rem" }}>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search network"
                style={{ width: "100%", boxSizing: "border-box", padding: "0.65rem 0.9rem", borderRadius: 12, border: "1px solid #E5E7EB", background: "#F8F7FF", fontSize: 14, outline: "none", color: "#111827" }} />
            </div>
            <div style={{ overflowY: "auto", padding: "0 0.6rem 0.8rem" }}>
              {pickerList.length === 0 && <div style={{ padding: "1.5rem", textAlign: "center", fontSize: 13, color: "#9CA3AF" }}>No network found.</div>}
              {pickerList.map(({ c, i }) => {
                const b = balances[c.key];
                const has = b != null && Number(b) > 0;
                return (
                  <button key={c.key} type="button" onClick={() => { setSourceIdx(i); setPickerOpen(false); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "0.7rem 0.65rem", border: "none", borderRadius: 14, background: i === sourceIdx ? "#F5F3FF" : "transparent", cursor: "pointer", textAlign: "left" }}>
                    <ChainLogo chain={c} size={36} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: "#111827" }}>{c.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF" }}>USDC</span>
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: has ? 700 : 500, color: has ? "#111827" : "#9CA3AF", textAlign: "right" }}>
                      {b === undefined ? "…" : b === null ? "—" : `${fmt(Number(b))} USDC`}
                    </span>
                    {i === sourceIdx && <Check size={16} color="#6D5EF7" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

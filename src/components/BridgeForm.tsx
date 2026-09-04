import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, encodePacked, zeroAddress, defineChain } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, lineaSepolia, optimismSepolia, polygonAmoy, avalancheFuji, unichainSepolia, worldchainSepolia, inkSepolia, plumeSepolia, seiTestnet, hyperliquidEvmTestnet } from "viem/chains";

// The default public RPC endpoints viem ships for these testnets sometimes
// route through free-tier providers (e.g. drpc.org) that reject certain
// calls with "chain is not available on free plan". Pin a reliable public
// RPC per chain instead of trusting the SDK defaults.
const sepoliaReliable = { ...sepolia, rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } } };
const baseSepoliaReliable = { ...baseSepolia, rpcUrls: { default: { http: ["https://base-sepolia-rpc.publicnode.com"] } } };
const arbitrumSepoliaReliable = { ...arbitrumSepolia, rpcUrls: { default: { http: ["https://arbitrum-sepolia-rpc.publicnode.com"] } } };
const lineaSepoliaReliable = { ...lineaSepolia, rpcUrls: { default: { http: ["https://linea-sepolia-rpc.publicnode.com"] } } };
const optimismSepoliaReliable = { ...optimismSepolia, rpcUrls: { default: { http: ["https://optimism-sepolia-rpc.publicnode.com"] } } };
const polygonAmoyReliable = { ...polygonAmoy, rpcUrls: { default: { http: ["https://polygon-amoy-bor-rpc.publicnode.com"] } } };
const avalancheFujiReliable = { ...avalancheFuji, rpcUrls: { default: { http: ["https://avalanche-fuji-c-chain-rpc.publicnode.com"] } } };
// viem's built-in sonicTestnet uses the wrong chain ID (64165); the real Sonic Testnet
// is 14601 — this matches Circle's own CCTP reference implementation exactly.
const sonicTestnet = defineChain({
  id: 14601,
  name: "Sonic Testnet",
  nativeCurrency: { decimals: 18, name: "Sonic", symbol: "S" },
  rpcUrls: { default: { http: ["https://rpc.testnet.soniclabs.com"] } },
  blockExplorers: { default: { name: "SonicScan", url: "https://testnet.sonicscan.org" } },
  testnet: true,
});
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import { getPendingFollowUp, clearPendingFollowUp, type PendingFollowUp } from "../pendingFollowUp";
import { addPoints } from "../gamification";
import EthBridge from "./EthBridge";
import ConfirmModal from "./ConfirmModal";
import { useIsMobile } from "../useIsMobile";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo, type CircleChain } from "../circleWalletHelpers";
import { ShieldCheck, Zap, Globe, ChevronDown, ArrowDownUp, BookOpen } from "lucide-react";

const TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa" as `0x${string}`;
const MESSAGE_TRANSMITTER = "0xe737e5cebeeba77efe34d4aa090756590b1ce275" as `0x${string}`;

// EURC (and other non-USDC assets) don't move through the canonical TokenMessengerV2.depositForBurn
// path at all — that's USDC-only. They go through a separate Circle product, "CCTPx" (Expanded
// Assets), with its own CrossChainTokenService contract, per-token TokenManager, a bytes32 tokenId,
// and a required signed fee quote from Iris. Confirmed live only between Ethereum Sepolia and Base
// Sepolia as of Circle's own quickstart — not confirmed for Arc Testnet.
const CCTS_ADDRESS: Partial<Record<ChainKey, `0x${string}`>> = {
  "Ethereum Sepolia": "0x63753E722bd2C2A5DF6EE19C5106662208B81077",
  "Base Sepolia": "0x63753E722bd2C2A5DF6EE19C5106662208B81077",
};
const EURC_TOKEN_ID = "0x2587821a0ee7daa174b95436b5dab1731cfa1844775b010217d3c0dd02a4eecd" as `0x${string}`;

const CCTS_ABI = [
  { name: "resolveTokenManager", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "bytes32" }], outputs: [{ name: "tokenManager", type: "address" }] },
  { name: "resolveTokenAddress", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "bytes32" }], outputs: [{ name: "token", type: "address" }] },
] as const;

const CROSS_CHAIN_TRANSFER_ABI = [{
  name: "crossChainTransfer", type: "function", stateMutability: "payable",
  inputs: [
    { name: "tokenId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "destinationAddress", type: "bytes" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "minFinalityThreshold", type: "uint32" },
    { name: "claim", type: "tuple", components: [
      { name: "signedQuote", type: "bytes" },
      { name: "refundAddress", type: "address" },
    ] },
    { name: "autoExecuteHookData", type: "bool" },
    { name: "hookData", type: "bytes" },
  ],
  outputs: [],
}] as const;

function parseIrisResponse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    throw new Error(
      "Circle's sandbox API is temporarily blocking requests (looks like a rate-limit / lockout page, not a JSON response). " +
      "This isn't a bug on our end — wait a few minutes before trying again."
    );
  }
  return JSON.parse(text);
}

async function irisProxyGet(path: string) {
  const res = await fetch(`/api/iris-proxy?path=${encodeURIComponent(path)}`);
  const text = await res.text();
  const data = parseIrisResponse(text);
  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data;
}

async function irisProxyPost(path: string, body: unknown) {
  const res = await fetch(`/api/iris-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, body }),
  });
  const text = await res.text();
  const data = parseIrisResponse(text);
  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data;
}

async function fetchCctpxQuote(tokenId: `0x${string}`, sourceDomain: number, destDomain: number, amount: bigint) {
  const data = await irisProxyPost(`/v1/quote/cctpx/${tokenId}/${sourceDomain}/${destDomain}`, {
    amount: amount.toString(),
    feeToken: "0x0000000000000000000000000000000000000000",
    requests: [{ type: "PRE_FINALITY" }],
  });
  return data as { signedQuote: `0x${string}`; feeTotalAmount: string };
}

async function checkCctpxFastAllowance(tokenId: `0x${string}`, amountUnits: bigint, decimals: number) {
  const body = (await irisProxyGet(`/v2/cctpx/allowances`)) as { allowances: { tokenId: string; allowance: number }[] };
  const allowance = body.allowances?.find(a => a.tokenId.toLowerCase() === tokenId.toLowerCase())?.allowance;
  const amountInTokenUnits = Number(amountUnits) / 10 ** decimals;
  if (allowance === undefined || allowance < amountInTokenUnits) {
    throw new Error(`Insufficient CCTPx fast-transfer allowance right now (available: ${allowance ?? 0}, need: ${amountInTokenUnits}). Try a smaller amount, or try again in a bit once allowance replenishes.`);
  }
}

const CHAINS = {
  "Arc Testnet": { chain: arcTestnet, domain: 26, usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`, eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}` | null, chainIdHex: ARC_CHAIN_ID_HEX, isArc: true, circleChain: "ARC-TESTNET" as CircleChain, dot: "#6D5EF7" },
  "Ethereum Sepolia": { chain: sepoliaReliable, domain: 0, usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as `0x${string}`, eurc: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4" as `0x${string}` | null, chainIdHex: "0xaa36a7", isArc: false, circleChain: "ETH-SEPOLIA" as CircleChain, dot: "#627eea" },
  "Base Sepolia": { chain: baseSepoliaReliable, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, eurc: "0x808456652fdb597867f38412077A9182bf77359F" as `0x${string}` | null, chainIdHex: "0x14a34", isArc: false, circleChain: "BASE-SEPOLIA" as CircleChain, dot: "#0052ff" },
  "Arbitrum Sepolia": { chain: arbitrumSepoliaReliable, domain: 3, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x66eee", isArc: false, circleChain: "ARB-SEPOLIA" as CircleChain, dot: "#28a0f0" },
  "Linea Sepolia": { chain: lineaSepoliaReliable, domain: 11, usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0xe705", isArc: false, circleChain: "LINEA-SEPOLIA" as CircleChain },
  "Optimism Sepolia": { chain: optimismSepoliaReliable, domain: 2, usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0xaa37dc", isArc: false, circleChain: "OP-SEPOLIA" as CircleChain },
  "Polygon Amoy": { chain: polygonAmoyReliable, domain: 7, usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x13882", isArc: false, circleChain: "MATIC-AMOY" as CircleChain },
  "Avalanche Fuji": { chain: avalancheFujiReliable, domain: 1, usdc: "0x5425890298aed601595a70AB815c96711a31Bc65" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0xa869", isArc: false, circleChain: "AVAX-FUJI" as CircleChain },
  "Sonic Testnet": { chain: sonicTestnet, domain: 13, usdc: "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x3909", isArc: false, circleChain: "SONIC-TESTNET" as CircleChain },
  "Unichain Sepolia": { chain: unichainSepolia, domain: 10, usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x515", isArc: false, circleChain: "UNICHAIN-SEPOLIA" as CircleChain },
  "World Chain Sepolia": { chain: worldchainSepolia, domain: 14, usdc: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x12c1", isArc: false, circleChain: "WORLDCHAIN-SEPOLIA" as CircleChain },
  "Ink Sepolia": { chain: inkSepolia, domain: 21, usdc: "0xFabab97dCE620294D2B0b0e46C68964e326300Ac" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0xba5ed", isArc: false, circleChain: "INK-SEPOLIA" as CircleChain },
  "Plume Testnet": { chain: plumeSepolia, domain: 22, usdc: "0xcB5f30e335672893c7eb944B374c196392C19D18" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x18233", isArc: false, circleChain: "PLUME-SEPOLIA" as CircleChain },
  "Sei Testnet": { chain: seiTestnet, domain: 16, usdc: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x530", isArc: false, circleChain: "SEI-TESTNET" as CircleChain },
  "HyperEVM Testnet": { chain: hyperliquidEvmTestnet, domain: 19, usdc: "0x2B3370eE501B4a559b57D449569354196457D8Ab" as `0x${string}`, eurc: null as `0x${string}` | null, chainIdHex: "0x3e6", isArc: false, circleChain: "HYPEREVM-TESTNET" as CircleChain },
} as const;
type ChainKey = keyof typeof CHAINS;
type Asset = "usdc" | "eurc";

const ASSET_META: Record<Asset, { label: string; badge: string; color: string }> = {
  usdc: { label: "USDC", badge: "$", color: "#6D5EF7" },
  eurc: { label: "EURC", badge: "€", color: "#7c3aed" },
};

function assetAddress(c: (typeof CHAINS)[ChainKey], asset: Asset): `0x${string}` | null {
  return asset === "usdc" ? c.usdc : c.eurc;
}

// USDC's Fast Transfer (finality threshold 1000) is well-exercised on these testnets with a
// small maxFee. EURC's Fast Transfer support/fee schedule isn't reliably documented for testnet,
// so if the requested maxFee is too low (or Fast isn't supported for the asset), Circle simply
// never attests via the fast path and the burn sits waiting for hard finality instead — which
// blows past a short poll window and looks "stuck" rather than erroring. Standard Transfer
// (threshold 2000) has no fee and no such risk, just a longer, deterministic wait.
function finalityParams(asset: Asset): { maxFee: bigint; minFinalityThreshold: number } {
  return asset === "usdc" ? { maxFee: 500n, minFinalityThreshold: 1000 } : { maxFee: 0n, minFinalityThreshold: 2000 };
}

interface Props {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
  onNavigate?: (tab: "swap" | "lending") => void;
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
      return;
    }
    throw e;
  }

  // Even when the wallet already knows this chain, re-offering it via
  // wallet_addEthereumChain can prompt some wallets (MetaMask in particular)
  // to update a stale/unreliable saved RPC endpoint to the one we prefer.
  // This is best-effort — most wallets just no-op if nothing changed.
  if (addParams) {
    try {
      await provider.request({ method: "wallet_addEthereumChain", params: [addParams] });
    } catch {
      // Ignore — the chain switch above already succeeded either way.
    }
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

// Turns raw viem/wallet errors into a short, human message instead of dumping
// the full technical error (calldata, docs links, etc.) in front of the user.
function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: number; shortMessage?: string };
  if (err.code === 4001 || err.message?.includes("User rejected")) {
    return "You rejected the request in your wallet. No funds were moved — try again when you're ready.";
  }
  if (err.message?.includes("insufficient funds") || err.message?.includes("exceeds balance")) {
    return "Insufficient balance to cover this amount plus gas.";
  }
  return err.shortMessage ?? err.message ?? "Bridge failed. Please try again.";
}

const HOW_IT_WORKS = [
  { title: "Select assets", desc: "Choose the chains and USDC amount you want to bridge" },
  { title: "Approve & Burn", desc: "Approve the transfer and burn USDC on the source chain" },
  { title: "Attestation", desc: "Circle verifies the burn and issues a signed attestation" },
  { title: "Receive on destination", desc: "Native USDC is minted directly to your wallet" },
];

export default function BridgeForm({ provider, address, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [followUp, setFollowUp] = useState<PendingFollowUp | null>(null);
  const [bridgeType, setBridgeType] = useState<"usdc" | "eth">("usdc");
  const [asset, setAsset] = useState<Asset>("usdc");
  const [sourceKey, setSourceKey] = useState<ChainKey>("Ethereum Sepolia");
  const [destKey, setDestKey] = useState<ChainKey>("Arc Testnet");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [destOpen, setDestOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "burning" | "attesting" | "minting" | "done" | "error">("idle");

  useEffect(() => {
    if (step === "done") {
      const pending = getPendingFollowUp();
      if (pending) {
        setFollowUp(pending);
        clearPendingFollowUp();
      }
    }
  }, [step]);
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
    function handleWalletChange() { setCircleWallet(getCircleWallet()); }
    window.addEventListener("circle-wallet-changed", handleWalletChange);
    return () => window.removeEventListener("circle-wallet-changed", handleWalletChange);
  }, []);

  const source = CHAINS[sourceKey];
  const dest = CHAINS[destKey];

  const [sourceBalance, setSourceBalance] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSourceBalance(null);
    const effectiveAddress = useCircle && circleWallet ? circleWallet.address : address;
    const tokenAddr = assetAddress(source, asset);
    if (!tokenAddr) { setSourceBalance("—"); return; }
    (async () => {
      try {
        const client = createPublicClient({ chain: source.chain, transport: http() });
        const bal = await client.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [effectiveAddress as `0x${string}`] });
        if (!cancelled) setSourceBalance(Number(bal) / 1e6 + "");
      } catch {
        if (!cancelled) setSourceBalance("—");
      }
    })();
    return () => { cancelled = true; };
  }, [sourceKey, address, useCircle, circleWallet, asset]);

  // If EURC is selected but the current source/destination isn't on a CCTPx-supported chain,
  // steer the user to a pair that actually works instead of failing silently. Token deployment
  // (CHAINS[k].eurc) isn't the right check here — CCTS_ADDRESS is, since that's what CCTPx
  // itself supports (confirmed only Ethereum Sepolia ↔ Base Sepolia as of Circle's quickstart).
  useEffect(() => {
    if (asset !== "eurc") return;
    const eurcChains = (Object.keys(CHAINS) as ChainKey[]).filter(k => CCTS_ADDRESS[k]);
    if (!CCTS_ADDRESS[sourceKey]) {
      const fallback = eurcChains.find(k => k !== destKey) ?? eurcChains[0];
      if (fallback) setSourceKey(fallback);
    }
    if (!CCTS_ADDRESS[destKey]) {
      const fallback = eurcChains.find(k => k !== sourceKey) ?? eurcChains[0];
      if (fallback) setDestKey(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  function changeSource(key: ChainKey) {
    setSourceKey(key);
    setSourceOpen(false);
    if (key === destKey) {
      const candidates = (Object.keys(CHAINS) as ChainKey[]).filter((k) => k !== key);
      const fallback = asset === "eurc" ? (candidates.find(k => CCTS_ADDRESS[k]) ?? candidates[0]) : candidates[0];
      if (fallback) setDestKey(fallback);
    }
    if (step === "done" || step === "error") { setStep("idle"); setBurnTxHash(null); setMintTxHash(null); setErrorMsg(null); }
  }
  function changeDest(key: ChainKey) {
    setDestKey(key);
    setDestOpen(false);
    if (key === sourceKey) {
      const candidates = (Object.keys(CHAINS) as ChainKey[]).filter((k) => k !== key);
      const fallback = asset === "eurc" ? (candidates.find(k => CCTS_ADDRESS[k]) ?? candidates[0]) : candidates[0];
      if (fallback) setSourceKey(fallback);
    }
    if (step === "done" || step === "error") { setStep("idle"); setBurnTxHash(null); setMintTxHash(null); setErrorMsg(null); }
  }
  function flipChains() {
    const s = sourceKey, d = destKey;
    setSourceKey(d);
    setDestKey(s);
    if (step === "done" || step === "error") { setStep("idle"); setBurnTxHash(null); setMintTxHash(null); setErrorMsg(null); }
  }

  async function pollAttestation(burnHash: string, domain: number) {
    // Fast Transfer (USDC) typically completes in well under a minute. Standard Transfer —
    // which EURC uses here, see finalityParams — waits for hard finality on the source chain
    // and can take considerably longer, so this window is sized for that worst case rather
    // than timing out while a legitimate Standard Transfer is still in flight.
    for (let i = 0; i < 120; i++) {
      try {
        const data = (await irisProxyGet(`/v2/messages/${domain}?transactionHash=${burnHash}`)) as { messages?: { status: string; message: string; attestation: string }[] };
        const msg = data?.messages?.[0];
        if (msg?.status === "complete") return msg as { message: string; attestation: string };
      } catch (e: unknown) {
        const msg = (e as { message?: string })?.message ?? "";
        if (msg.includes("rate-limit") || msg.includes("lockout")) throw e; // don't keep hammering a block
        // Otherwise: not indexed yet, or a transient error — keep polling.
      }
      await new Promise(r => setTimeout(r, 10000));
    }
    throw new Error("Attestation is taking longer than expected. Your funds are safe — the burn is confirmed on-chain. You can mint later using the burn tx hash once Circle finishes attesting.");
  }

  async function doBridgeWithCircle() {
    if (!circleWallet) return;
    if (asset === "eurc") {
      throw new Error("EURC bridging via Circle Wallet isn't implemented yet — switch to Browser Wallet for EURC, or use USDC with Circle Wallet.");
    }
    const sourceWalletId = getWalletIdForChain(circleWallet, source.circleChain);
    const destWalletId = getWalletIdForChain(circleWallet, dest.circleChain);
    if (!sourceWalletId || !destWalletId) {
      setErrorMsg(`Circle Wallet is missing an account on ${!sourceWalletId ? sourceKey : destKey}.`);
      setStep("error");
      return;
    }
    const tokenAddr = assetAddress(source, asset);
    if (!tokenAddr || !assetAddress(dest, asset)) {
      setErrorMsg(`${ASSET_META[asset].label} isn't deployed on ${!assetAddress(source, asset) ? sourceKey : destKey} yet.`);
      setStep("error");
      return;
    }
    const amountUnits = BigInt(Math.round(Number(amount) * 1e6));

    setStep("approving");
    await circleContractCallAndWait({
      walletId: sourceWalletId,
      contractAddress: tokenAddr,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [TOKEN_MESSENGER, amountUnits.toString()],
    });

    setStep("burning");
    const { maxFee, minFinalityThreshold } = finalityParams(asset);
    const burnHash = await circleContractCallAndWait({
      walletId: sourceWalletId,
      contractAddress: TOKEN_MESSENGER,
      abiFunctionSignature: "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
      abiParameters: [
        amountUnits.toString(),
        dest.domain,
        bytes32Address(circleWallet.address),
        tokenAddr,
        bytes32Address("0x0000000000000000000000000000000000000000"),
        maxFee.toString(),
        minFinalityThreshold,
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
    addPoints(15);
  }

  const [showBridgeConfirm, setShowBridgeConfirm] = useState(false);

  function doBridge() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMsg("Enter a valid amount."); return;
    }
    if (sourceKey === destKey) {
      setErrorMsg("Source and destination must be different."); return;
    }
    if (asset === "eurc" && (!CCTS_ADDRESS[sourceKey] || !CCTS_ADDRESS[destKey])) {
      setErrorMsg(`EURC bridging only works between Ethereum Sepolia and Base Sepolia right now — ${!CCTS_ADDRESS[sourceKey] ? sourceKey : destKey} isn't on Circle's CCTPx yet.`); return;
    }
    if (!assetAddress(source, asset) || !assetAddress(dest, asset)) {
      setErrorMsg(`${ASSET_META[asset].label} isn't deployed on ${!assetAddress(source, asset) ? sourceKey : destKey} yet.`); return;
    }
    setErrorMsg(null);
    setShowBridgeConfirm(true);
  }

  async function executeBridge() {
    setShowBridgeConfirm(false);
    setBurnTxHash(null);
    setMintTxHash(null);

    if (useCircle && circleWallet) {
      try {
        await doBridgeWithCircle();
      } catch (e: unknown) {
        setErrorMsg(friendlyError(e));
        setStep("error");
      }
      return;
    }

    try {
      if (asset === "eurc") {
        await doBridgeEurcCctpx();
      } else {
        await doBridgeUsdcStandard();
      }
      showToast("Bridge completed", "success");
      addPoints(15);
    } catch (e: unknown) {
      setErrorMsg(friendlyError(e));
      setStep("error");
    }
  }

  async function doBridgeUsdcStandard() {
    const tokenAddr = assetAddress(source, asset);
    if (!tokenAddr) throw new Error(`${ASSET_META[asset].label} isn't deployed on ${sourceKey} yet.`);
    const amountUnits = BigInt(Math.round(Number(amount) * 1e6));
    await switchChain(provider, source.chainIdHex, addChainParams(sourceKey));
    const sourceWallet = createWalletClient({ chain: source.chain, transport: custom(provider) });
    const sourcePublic = createPublicClient({ chain: source.chain, transport: http() });

    setStep("approving");
    const approveHash = await sourceWallet.writeContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "approve",
      args: [TOKEN_MESSENGER, amountUnits],
      account: address as `0x${string}`,
    });
    const approveReceipt = await sourcePublic.waitForTransactionReceipt({ hash: approveHash });
    if (approveReceipt.status !== "success") {
      throw new Error(`Approve transaction reverted on-chain (${approveHash}). No funds were moved.`);
    }

    setStep("burning");
    const { maxFee, minFinalityThreshold } = finalityParams(asset);
    const burnArgs = [
      amountUnits,
      dest.domain,
      bytes32Address(address),
      tokenAddr,
      bytes32Address("0x0000000000000000000000000000000000000000"),
      maxFee,
      minFinalityThreshold,
    ] as const;
    try {
      await sourcePublic.simulateContract({
        address: TOKEN_MESSENGER, abi: DEPOSIT_FOR_BURN_ABI, functionName: "depositForBurn",
        args: burnArgs, account: address as `0x${string}`,
      });
    } catch (simErr: unknown) {
      const msg = (simErr as { shortMessage?: string; message?: string })?.shortMessage ?? (simErr as { message?: string })?.message ?? "unknown reason";
      throw new Error(`This burn would fail on-chain (${msg}). Most likely ${assetLabel} isn't registered for CCTP burning on ${sourceKey} yet, even though the token is deployed there. No transaction was sent, no gas spent.`);
    }
    const burnHash = await sourceWallet.writeContract({
      address: TOKEN_MESSENGER,
      abi: DEPOSIT_FOR_BURN_ABI,
      functionName: "depositForBurn",
      args: burnArgs,
      account: address as `0x${string}`,
    });
    const burnReceipt = await sourcePublic.waitForTransactionReceipt({ hash: burnHash });
    if (burnReceipt.status !== "success") {
      throw new Error(
        `The burn reverted on-chain (tx ${burnHash.slice(0, 10)}...) — most likely "burn token not supported": ` +
        `${assetLabel} may not be registered for CCTP burning on ${sourceKey} yet, even though the token itself is deployed there. ` +
        `Check the tx on the explorer for the exact revert reason. No funds were moved.`
      );
    }
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
    const mintReceipt = await destPublic.waitForTransactionReceipt({ hash: mintHash });
    if (mintReceipt.status !== "success") {
      throw new Error(`The mint reverted on-chain (tx ${mintHash.slice(0, 10)}...) on ${destKey}. Your burn is still valid — you can retry minting with the same attestation.`);
    }
    setMintTxHash(mintHash);
    setStep("done");
  }

  // EURC moves through Circle's CCTPx (Expanded Assets) product, not canonical CCTP — a separate
  // CrossChainTokenService contract, a per-token TokenManager for approvals, a bytes32 tokenId
  // instead of an ERC20 address, and a required signed fee quote from Iris paid in native ETH.
  // Confirmed only between Ethereum Sepolia and Base Sepolia; doBridge() already blocks other pairs.
  async function doBridgeEurcCctpx() {
    const ccts = CCTS_ADDRESS[sourceKey];
    if (!ccts) throw new Error(`EURC (CCTPx) isn't available from ${sourceKey} yet.`);
    await switchChain(provider, source.chainIdHex, addChainParams(sourceKey));
    const sourceWallet = createWalletClient({ chain: source.chain, transport: custom(provider) });
    const sourcePublic = createPublicClient({ chain: source.chain, transport: http() });

    // EURC's decimals is a fixed, documented constant (Circle's own CCTPx quickstart:
    // "EURC uses 6 decimals") — querying it fresh from IRIS every single attempt was an
    // unnecessary extra request, and every request counts while we're recovering from a
    // sandbox rate-limit lockout.
    const decimals = 6;
    const amountUnits = BigInt(Math.round(Number(amount) * 10 ** decimals));

    const [tokenManager, tokenAddr] = await Promise.all([
      sourcePublic.readContract({ address: ccts, abi: CCTS_ABI, functionName: "resolveTokenManager", args: [EURC_TOKEN_ID] }),
      sourcePublic.readContract({ address: ccts, abi: CCTS_ABI, functionName: "resolveTokenAddress", args: [EURC_TOKEN_ID] }),
    ]);

    setStep("approving");
    const approveHash = await sourceWallet.writeContract({
      address: tokenAddr, abi: erc20Abi, functionName: "approve", args: [tokenManager, amountUnits], account: address as `0x${string}`,
    });
    const approveReceipt = await sourcePublic.waitForTransactionReceipt({ hash: approveHash });
    if (approveReceipt.status !== "success") {
      throw new Error(`Approve transaction reverted on-chain (${approveHash}). No funds were moved.`);
    }

    // Best-effort only — this is a courtesy pre-check, not the source of truth (the actual
    // transfer's own simulateContract call below will catch a real insufficient-allowance
    // revert regardless). Skipping it on failure means one less request that can trip a lockout.
    try {
      await checkCctpxFastAllowance(EURC_TOKEN_ID, amountUnits, decimals);
    } catch {
      /* proceed — the pre-flight simulate below is the real safety check */
    }

    setStep("burning");
    const quote = await fetchCctpxQuote(EURC_TOKEN_ID, source.domain, dest.domain, amountUnits);
    const feeTotalAmount = BigInt(quote.feeTotalAmount);
    const destinationAddressPacked = encodePacked(["address"], [address as `0x${string}`]);
    const burnArgs = [
      EURC_TOKEN_ID,
      amountUnits,
      dest.domain,
      destinationAddressPacked,
      bytes32Address("0x0000000000000000000000000000000000000000"),
      1000,
      { signedQuote: quote.signedQuote, refundAddress: zeroAddress },
      false,
      "0x" as `0x${string}`,
    ] as const;
    try {
      await sourcePublic.simulateContract({
        address: ccts, abi: CROSS_CHAIN_TRANSFER_ABI, functionName: "crossChainTransfer",
        args: burnArgs, account: address as `0x${string}`, value: feeTotalAmount,
      });
    } catch (simErr: unknown) {
      const msg = (simErr as { shortMessage?: string; message?: string })?.shortMessage ?? (simErr as { message?: string })?.message ?? "unknown reason";
      throw new Error(`This transfer would fail on-chain (${msg}). No transaction was sent, no gas spent.`);
    }
    const burnHash = await sourceWallet.writeContract({
      address: ccts, abi: CROSS_CHAIN_TRANSFER_ABI, functionName: "crossChainTransfer",
      args: burnArgs, account: address as `0x${string}`, value: feeTotalAmount,
    });
    const burnReceipt = await sourcePublic.waitForTransactionReceipt({ hash: burnHash });
    if (burnReceipt.status !== "success") {
      throw new Error(`The transfer reverted on-chain (tx ${burnHash.slice(0, 10)}...). Check the tx on the explorer for the exact reason. No funds were moved.`);
    }
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
    const mintReceipt = await destPublic.waitForTransactionReceipt({ hash: mintHash });
    if (mintReceipt.status !== "success") {
      throw new Error(`The mint reverted on-chain (tx ${mintHash.slice(0, 10)}...) on ${destKey}. Your transfer is still valid — you can retry minting with the same attestation.`);
    }
    setMintTxHash(mintHash);
    setStep("done");
  }

  const isLoading = step === "approving" || step === "burning" || step === "attesting" || step === "minting";
  const assetLabel = ASSET_META[asset].label;
  const stepLabels: Record<string, string> = {
    approving: `Approving ${assetLabel} on ${sourceKey}...`,
    burning: `Burning ${assetLabel} on ${sourceKey}...`,
    attesting: asset === "usdc" ? "Waiting for Circle attestation (can take 1-2 min)..." : "Waiting for Circle attestation — EURC uses Standard Transfer here, this can take several minutes...",
    minting: `Minting ${assetLabel} on ${destKey}...`,
  };
  const stepIndexMap: Record<string, number> = { idle: -1, approving: 1, burning: 1, attesting: 2, minting: 3, done: 4, error: -1 };
  const activeStepIndex = stepIndexMap[step] ?? -1;

  function chainIdDecimal(hex: string): number {
    return parseInt(hex, 16);
  }

  // Real chain logos from DefiLlama's public icon CDN, by chain-brand slug. Arc has no
  // confirmed DefiLlama entry (too new), so it always uses the hand-drawn fallback below.
  // A couple of these slugs (world_chain, plume, optimism) aren't independently confirmed —
  // if a slug is wrong the <img> below fails to load and we fall back automatically, so a
  // wrong guess never shows a broken image, just the hand-drawn version.
  const DEFILLAMA_SLUG: Partial<Record<ChainKey, string>> = {
    "Ethereum Sepolia": "ethereum",
    "Base Sepolia": "base",
    "Arbitrum Sepolia": "arbitrum",
    "Linea Sepolia": "linea",
    "Optimism Sepolia": "optimism",
    "Polygon Amoy": "polygon",
    "Avalanche Fuji": "avalanche",
    "Sonic Testnet": "sonic",
    "Unichain Sepolia": "unichain",
    "World Chain Sepolia": "world_chain",
    "Ink Sepolia": "ink",
    "Plume Testnet": "plume",
    "Sei Testnet": "sei",
    "HyperEVM Testnet": "hyperliquid",
  };

  function ChainIcon({ chainKey, size = 22 }: { chainKey: ChainKey; size?: number }) {
    const [imgFailed, setImgFailed] = useState(false);
    const slug = DEFILLAMA_SLUG[chainKey];
    if (slug && !imgFailed) {
      return (
        <img
          src={`https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`}
          width={size} height={size} alt={chainKey}
          style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, display: "block" }}
          onError={() => setImgFailed(true)}
        />
      );
    }
    return <ChainIconFallback chainKey={chainKey} size={size} />;
  }

  function ChainIconFallback({ chainKey, size = 22 }: { chainKey: ChainKey; size?: number }) {
    const common = { width: size, height: size, viewBox: "0 0 24 24" };
    switch (chainKey) {
      case "Arc Testnet":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#0E1E3D" />
            <path d="M6.3 19.5 C6.3 9.5 8.3 3.3 12 3.3 C15.7 3.3 17.7 9.3 17.7 14.3" stroke="#E7EBF3" strokeWidth="2.9" fill="none" strokeLinecap="round" />
            <path d="M11 13.2 L15 13.2" stroke="#E7EBF3" strokeWidth="2.7" strokeLinecap="round" />
            <path d="M17.7 14.3 C17.7 17.6 15.6 19.3 12.8 18.7" stroke="#E7EBF3" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </svg>
        );
      case "Ethereum Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#627eea" />
            <path d="M12 3l5.5 9.2L12 15.5 6.5 12.2 12 3z" fill="#fff" fillOpacity="0.9" />
            <path d="M12 16.8l5.5-3.9L12 21l-5.5-8.1 5.5 3.9z" fill="#fff" fillOpacity="0.7" />
          </svg>
        );
      case "Base Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#0052ff" />
            <rect x="7.2" y="11.2" width="9.6" height="1.6" rx="0.8" fill="#fff" />
          </svg>
        );
      case "Arbitrum Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#213147" />
            <path d="M12 4.5l6 3.4v8.2l-6 3.4-6-3.4V7.9l6-3.4z" fill="none" stroke="#28a0f0" strokeWidth="1.3" />
            <path d="M9.5 15.5l2-6.5 1 3-1.6 4.4-1.4-.9z" fill="#28a0f0" />
            <path d="M13.2 8.8L15.5 15.5l-1.5.9-1.8-5.1 1-2.5z" fill="#fff" />
          </svg>
        );
      case "Linea Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#121212" />
            <path d="M8.5 7.5v7.6h5.4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="7.5" r="1.3" fill="#fff" />
          </svg>
        );
      case "Optimism Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#FF0420" />
            <circle cx="12" cy="12" r="5.2" fill="none" stroke="#fff" strokeWidth="2.1" />
          </svg>
        );
      case "Polygon Amoy":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#7B3FE4" />
            <path d="M15.5 8.5l2.3 1.3v2.6l-2.3 1.3-2.3-1.3v-1.3l1.2-.7v1.3l1.1.6 1.1-.6V10l-1.1-.6-1.1.6-1.2-.7 2.3-1.3z" fill="#fff" />
            <path d="M8.5 15.5l-2.3-1.3v-2.6l2.3-1.3 2.3 1.3v1.3l-1.2.7v-1.3l-1.1-.6-1.1.6V14l1.1.6 1.1-.6 1.2.7-2.3 1.3z" fill="#fff" />
          </svg>
        );
      case "Avalanche Fuji":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#E84142" />
            <path d="M9.3 16h-2l3.4-6 1 1.8-2.4 4.2z" fill="#fff" />
            <path d="M12.6 8l3.8 8h-2.2l-1-2h-2.9l1-1.8h1l-1-2 1.3-2.2z" fill="#fff" />
          </svg>
        );
      case "Sonic Testnet":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#fff" />
            <path d="M6 13c2-4 4.5-6 8-4.5-3 .5-4.5 2-5.5 4.5-1.5 3.5-3.5 2.5-2.5 0z" fill="#111" />
            <path d="M18 11c-2 4-4.5 6-8 4.5 3-.5 4.5-2 5.5-4.5 1.5-3.5 3.5-2.5 2.5 0z" fill="#111" />
          </svg>
        );
      case "Unichain Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#F50DB4" />
            <path d="M12 5l1.4 5.6L19 12l-5.6 1.4L12 19l-1.4-5.6L5 12l5.6-1.4L12 5z" fill="#fff" />
          </svg>
        );
      case "World Chain Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#fff" />
            <ellipse cx="12" cy="12" rx="7" ry="3.4" fill="none" stroke="#111" strokeWidth="1.3" />
            <circle cx="12" cy="12" r="3" fill="none" stroke="#111" strokeWidth="1.3" />
          </svg>
        );
      case "Ink Sepolia":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#7132F5" />
            <path d="M9 8c0 2 3 2 3 4s-3 2-3 4M15 8c0 2-3 2-3 4s3 2 3 4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
        );
      case "Plume Testnet":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#FF6B35" />
            <rect x="6.5" y="9" width="7" height="7" rx="1.6" fill="none" stroke="#fff" strokeWidth="1.5" transform="rotate(-10 10 12.5)" />
            <rect x="10.5" y="8" width="7" height="7" rx="1.6" fill="none" stroke="#fff" strokeWidth="1.5" transform="rotate(10 14 11.5)" />
          </svg>
        );
      case "Sei Testnet":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#8B1A2B" />
            <path d="M5.5 9c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            <path d="M5.5 12.8c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            <path d="M5.5 16.6c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        );
      case "HyperEVM Testnet":
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="12" fill="#0A2E2C" />
            <path d="M9 7c-2.5 1.5-3.5 4-2.5 6.5C7.5 16 10 17 12.5 16c2-.8 3-2.5 2-4-1-1.6-3-1.4-3.5.3-.4 1.5.7 2.7 2 2.2" fill="none" stroke="#7EF5D6" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
    }
  }

  function ChainRow({ chainKey, open, setOpen, onSelect }: { chainKey: ChainKey; open: boolean; setOpen: (v: boolean) => void; onSelect: (k: ChainKey) => void }) {
    const c = CHAINS[chainKey];
    return (
      <div style={{ position: "relative" }}>
        <button onClick={() => setOpen(!open)} disabled={isLoading}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderRadius: 14, border: "1px solid #D4C9FA", background: "#ffffff", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ChainIcon chainKey={chainKey} size={26} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{chainKey}</span>
              <span className="flowfi-mono" style={{ fontSize: 10, color: "#9CA3AF" }}>Chain ID: {chainIdDecimal(c.chainIdHex)}</span>
            </div>
          </div>
          <ChevronDown size={16} color="#6B7280" />
        </button>
        {open && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20, background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 14, padding: 6, boxShadow: "0 12px 30px rgba(109,94,247,0.18)" }}>
            {(Object.keys(CHAINS) as ChainKey[]).map((k) => (
              <button key={k} onClick={() => onSelect(k)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.75rem", borderRadius: 10, border: "none", background: k === chainKey ? "#f5f3ff" : "transparent", cursor: "pointer", textAlign: "left" }}>
                <ChainIcon chainKey={k} size={22} />
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{k}</span>
                  <span className="flowfi-mono" style={{ fontSize: 9.5, color: "#9CA3AF" }}>Chain ID: {chainIdDecimal(CHAINS[k].chainIdHex)}</span>
                </div>
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
          Stablecoin Bridge
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
            <div style={{ display: "flex", gap: 6 }}>
              {(["usdc", "eurc"] as Asset[]).map((a) => (
                <button key={a} onClick={() => setAsset(a)} disabled={isLoading}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.5rem", borderRadius: 10, border: "none", background: asset === a ? "#ede9fe" : "#f5f3ff", color: asset === a ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  <span style={{ width: 16, height: 16, borderRadius: "50%", background: ASSET_META[a].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#fff" }}>{ASSET_META[a].badge}</span>
                  {ASSET_META[a].label}
                </button>
              ))}
            </div>
            {asset === "eurc" && (
              <p style={{ fontSize: 11, color: "#B45309", margin: 0 }}>
                EURC moves through Circle's CCTPx (Expanded Assets), separate from standard USDC bridging — only Ethereum Sepolia ↔ Base Sepolia is confirmed supported right now.
              </p>
            )}

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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 13, color: "#4B5563", fontWeight: 600 }}>From</label>
                <span className="flowfi-mono" style={{ fontSize: 12, color: "#6B7280" }}>
                  Balance: <span style={{ color: ASSET_META[asset].color, fontWeight: 700 }}>{sourceBalance ?? "..."} {assetLabel}</span>
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <ChainRow chainKey={sourceKey} open={sourceOpen} setOpen={setSourceOpen} onSelect={changeSource} />
              </div>
              {!assetAddress(source, asset) && (
                <p style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>{assetLabel} isn't deployed on {sourceKey} yet — pick a different source.</p>
              )}
            </div>

            <div style={{ borderRadius: 16, border: "1px solid #D4C9FA", padding: "1rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <input type="number" min="0" step="0.01" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", boxShadow: "none", fontSize: 32, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#f5f3ff" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: ASSET_META[asset].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{ASSET_META[asset].badge}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{assetLabel}</span>
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <span className="flowfi-mono" style={{ fontSize: 12, color: "#6B7280" }}>{amount ? `${ASSET_META[asset].badge}${Number(amount).toFixed(2)}` : `${ASSET_META[asset].badge}0.00`}</span>
                {sourceBalance && sourceBalance !== "—" && (
                  <button onClick={() => setAmount(sourceBalance)} disabled={isLoading}
                    style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                    Max
                  </button>
                )}
              </div>
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
              {!assetAddress(dest, asset) && (
                <p style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>{assetLabel} isn't deployed on {destKey} yet — pick a different destination.</p>
              )}
            </div>

            <div style={{ borderRadius: 16, border: "1px solid #D4C9FA", padding: "1rem 1.1rem", background: "#f5f3ff" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <span className="flowfi-mono" style={{ fontSize: 32, fontWeight: 700, color: "#111827" }}>{amount ? Number(amount).toFixed(2) : "0"}</span>
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, background: "#ffffff" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: ASSET_META[asset].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{ASSET_META[asset].badge}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{assetLabel}</span>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>Estimated — native {assetLabel}, no wrapped tokens</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 8 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>Est. time</div>
                <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>~20 sec</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>Network fee</div>
                <div className="flowfi-mono" style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>0.0005 {assetLabel}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>You receive</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Native {assetLabel}</div>
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

            {showBridgeConfirm && (
              <ConfirmModal
                title="Confirm Bridge"
                rows={[
                  { label: "Amount", value: `${amount} ${assetLabel}`, highlight: true },
                  { label: "From", value: sourceKey },
                  { label: "To", value: destKey },
                ]}
                confirmLabel="Confirm Bridge"
                onConfirm={executeBridge}
                onCancel={() => setShowBridgeConfirm(false)}
              />
            )}

            {step === "done" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {followUp ? (
                  <div style={{ background: "linear-gradient(135deg, #6D5EF7, #4F6BFF)", borderRadius: 14, padding: "1rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
                    <svg style={{ position: "absolute", top: 0, right: 0, width: 140, height: "100%", pointerEvents: "none", opacity: 0.35 }} viewBox="0 0 140 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M0 100 C 40 90, 60 50, 140 30" stroke="#fff" strokeWidth="1.5" opacity="0.5"/>
                      <path d="M20 100 C 60 95, 80 60, 140 55" stroke="#fff" strokeWidth="1.5" opacity="0.3"/>
                    </svg>
                    <div style={{ position: "relative", fontSize: 12.5, color: "#ffffff", marginBottom: 8, opacity: 0.95 }}>
                      Bridge complete. Continuing to {followUp.action === "swap" ? `swap it to ${followUp.toToken}` : "Lending"}, as requested.
                    </div>
                    <button onClick={() => onNavigate?.(followUp.action === "swap" ? "swap" : "lending")}
                      style={{ position: "relative", width: "100%", padding: "0.65rem", borderRadius: 10, border: "none", background: "#ffffff", color: "#6D5EF7", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                      Continue →
                    </button>
                  </div>
                ) : (
                  <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: 12.5, color: "#4B5563", marginBottom: 8 }}>
                      {asset === "usdc" && destKey === "Arc Testnet"
                        ? "Your USDC just landed on Arc, as native gas — ready to use."
                        : `Your ${assetLabel} just landed on ${destKey} — ready to use.`}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => onNavigate?.("swap")}
                        style={{ flex: 1, padding: "0.65rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                        Swap it
                      </button>
                      <button onClick={() => onNavigate?.("lending")}
                        style={{ flex: 1, padding: "0.65rem", borderRadius: 10, border: "1px solid #D4C9FA", background: "#ffffff", color: "#6D5EF7", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                        Supply to Lending
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={() => { setStep("idle"); setBurnTxHash(null); setMintTxHash(null); setAmount(""); setFollowUp(null); }}
                  style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#4B5563", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  New Bridge
                </button>
              </div>
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

            <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 12 }}>Supported assets</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { symbol: "USDC", name: "USD Coin", logo: "https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
                  { symbol: "EURC", name: "Euro Coin", logo: "https://assets.coingecko.com/coins/images/26045/small/euro.png" },
                  { symbol: "ARCC", name: "Arc Coin", logo: null },
                ].map((t) => (
                  <div key={t.symbol} style={{ textAlign: "center" }}>
                    {t.logo ? (
                      <img src={t.logo} alt={t.symbol} style={{ width: 34, height: 34, borderRadius: "50%", margin: "0 auto 6px", display: "block" }} />
                    ) : (
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800, margin: "0 auto 6px" }}>
                        {t.symbol[0]}
                      </div>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#111827" }}>{t.symbol}</div>
                    <div style={{ fontSize: 9, color: "#6B7280" }}>{t.name}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 10, marginBottom: 0 }}>EURC bridges via Circle's separate CCTPx product, confirmed only between Ethereum Sepolia and Base Sepolia — untested against live contracts, report issues if it doesn't work. USDC bridges across all four chains via standard CCTP.</p>
            </div>
          </div>
        </div>
      )}

      {bridgeType === "usdc" && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "1rem", background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ShieldCheck size={18} color="#6D5EF7" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 2 }}>Secure</div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>Audited by Circle and industry leaders</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Zap size={18} color="#6D5EF7" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 2 }}>Fast</div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>Average transfer time under 2 minutes</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Globe size={18} color="#6D5EF7" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 2 }}>Cross-chain</div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>Move assets across multiple supported networks</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

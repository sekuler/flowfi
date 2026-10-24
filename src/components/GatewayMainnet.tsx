import { useState, useEffect, useRef } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, parseUnits, pad, isAddress } from "viem";
import type { Chain, EIP1193Provider } from "viem";
import { mainnet, base, arbitrum, avalanche, worldchain } from "viem/chains";
import { RefreshCw, Layers } from "lucide-react";
import { arcMainnet } from "../chains";
import type { LiveCircleWallet } from "./ConnectModal";
import { ChainLogo, TokenLogo, type ChainKey } from "./AssetLogos";
import { useIsMobile } from "../useIsMobile";
import { UnifiedBalanceKit } from "@circle-fin/unified-balance-kit";
import { createKitAdapter } from "../kitAdapter";

// Circle Gateway on MAINNET: one balance across chains for USDC, EURC and cirBTC.
// EURC/cirBTC support: Unified Balance Kit 1.9.0 (Oct 23, 2026). Chain list, token addresses and
// Gateway domains below match the kit's own chain definitions (getSupportedChains / token registry).
// EURC: Arc, Avalanche, Base, Ethereum, World Chain, Solana. cirBTC: Arc, Ethereum.
// Solana is a send destination only here (the page signs with an EVM browser wallet).
// Sources (developers.circle.com, checked 2026-09-25):
//  - contracts, same address on every mainnet chain: gateway/references/contract-addresses
//  - API gateway-api.circle.com (/v1/balances, /v1/estimate, /v1/transfer, /v1/transfer/{id})
//  - fees (0.5 bp + per-source gas; forwarding $0.05 + gas): gateway/references/fees
//  - EIP-712 BurnIntent types copied verbatim from Circle's gateway contracts (see gatewayTransfer.ts)
// Transfers use Circle's Forwarding Service, so Circle mints on the destination chain and the
// user needs no gas there. Works with either the connected browser wallet (user signs) or the
// Circle Wallet (signed server-side, only for Gateway burn intents from that wallet).
const GATEWAY_API = "https://gateway-api.circle.com";
const GATEWAY_WALLET = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" as const;
const GATEWAY_MINTER = "0x2222222d7164433c4C09B0b0D809a9b52C04C205" as const;
const CIRCLE_API = "/api/circle-wallet-mainnet";

// Circle Unified Balance Kit (@circle-fin/unified-balance-kit) runs browser-wallet deposits and
// sends/withdrawals (Gateway spend with Circle's Forwarding Service). Circle Wallet stays on the
// manual path below (it signs server-side). Set to false to roll back.
const USE_KIT = true;
const KIT_CHAIN: Record<string, "Arc" | "Base" | "Ethereum" | "Arbitrum" | "Avalanche" | "World_Chain" | "Solana"> = { arc: "Arc", base: "Base", ethereum: "Ethereum", arbitrum: "Arbitrum", avalanche: "Avalanche", worldchain: "World_Chain", solana: "Solana" };

type GToken = "USDC" | "EURC" | "cirBTC";
const TOKEN_LIST: GToken[] = ["USDC", "EURC", "cirBTC"];
const DECIMALS: Record<GToken, number> = { USDC: 6, EURC: 6, cirBTC: 8 };

interface GChain { key: string; name: string; circleCode: string; domain: number; chain: Chain; tokens: Partial<Record<GToken, `0x${string}`>>; explorer: string; slow: boolean; gas: string }
const CHAINS: GChain[] = [
  { key: "arc", name: "Arc", circleCode: "ARC", domain: 26, chain: arcMainnet, explorer: "https://arc.etherscan.io", slow: false, gas: "USDC",
    tokens: { USDC: "0x3600000000000000000000000000000000000000", EURC: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", cirBTC: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0" } },
  { key: "base", name: "Base", circleCode: "BASE", domain: 6, chain: base, explorer: "https://basescan.org", slow: true, gas: "ETH",
    tokens: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" } },
  { key: "ethereum", name: "Ethereum", circleCode: "ETH", domain: 0, chain: mainnet, explorer: "https://etherscan.io", slow: true, gas: "ETH",
    tokens: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", EURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", cirBTC: "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E" } },
  { key: "arbitrum", name: "Arbitrum", circleCode: "ARB", domain: 3, chain: arbitrum, explorer: "https://arbiscan.io", slow: true, gas: "ETH",
    tokens: { USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" } },
  { key: "avalanche", name: "Avalanche", circleCode: "AVAX", domain: 1, chain: avalanche, explorer: "https://snowtrace.io", slow: false, gas: "AVAX",
    tokens: { USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", EURC: "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD" } },
  { key: "worldchain", name: "World Chain", circleCode: "WORLD", domain: 14, chain: worldchain, explorer: "https://worldscan.org", slow: true, gas: "ETH",
    tokens: { USDC: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", EURC: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B" } },
];
// Send-only destination (no EVM wallet there). USDC and EURC only.
const SOLANA_DEST = { key: "solana", name: "Solana" } as const;
const SOLANA_TOKENS: GToken[] = ["USDC", "EURC"];
const isSolanaAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const chainsFor = (t: GToken) => CHAINS.filter((c) => !!c.tokens[t]);

const EIP712_DOMAIN = { name: "GatewayWallet", version: "1" } as const;
const EIP712_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;
const GATEWAY_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;
const ZERO32 = `0x${"0".repeat(64)}` as `0x${string}`;

const BLUE = "#3D5AF1";
// Cards use the Arc navy gradient, so text/line tokens are light. PAGE_* are for text that
// sits on the light page background outside the cards.
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#DCE2F7";
const PAGE_MUTED = "#5E5B6B";

const b32 = (a: string) => pad(a as `0x${string}`, { size: 32 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toJSON = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function switchTo(provider: EIP1193Provider, chain: Chain) {
  const want = `0x${chain.id.toString(16)}`;
  const cur = (await provider.request({ method: "eth_chainId" })) as string;
  if (cur.toLowerCase() === want.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code !== 4902) throw e;
    const isArc = chain.id === arcMainnet.id;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [isArc
        ? { chainId: want, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }
        : { chainId: want, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [] }],
    });
  }
}

async function circlePost(body: Record<string, unknown>) {
  const res = await fetch(CIRCLE_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: toJSON(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw new Error(d.error ?? "Circle Wallet request failed.");
  return d;
}

async function circleCallAndWait(body: Record<string, unknown>) {
  const { transactionId } = await circlePost({ action: "contractCall", ...body });
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const s = await circlePost({ action: "getTransaction", transactionId });
    if (s.state === "COMPLETE") return s.txHash as string;
    if (["FAILED", "CANCELLED", "DENIED"].includes(s.state)) throw new Error(s.errorReason ?? `Transaction ${String(s.state).toLowerCase()}.`);
    await sleep(3000);
  }
  throw new Error("Still processing. Check again in a minute.");
}


export default function GatewayMainnet({ browserAddress, provider, circleLive, onOpenNativeBridge, onConnect }: { browserAddress?: string; provider?: EIP1193Provider; circleLive?: LiveCircleWallet | null; onOpenNativeBridge?: () => void; onConnect?: () => void }) {
  const [source, setSource] = useState<"browser" | "circle">(browserAddress ? "browser" : "circle");
  const hasBrowser = !!browserAddress && !!provider;
  const hasCircle = !!circleLive;
  useEffect(() => {
    if (source === "browser" && !hasBrowser && hasCircle) setSource("circle");
    if (source === "circle" && !hasCircle && hasBrowser) setSource("browser");
  }, [hasBrowser, hasCircle]);

  const owner = source === "browser" ? browserAddress : circleLive?.address;
  // Token picker (browser wallet). Circle Wallet stays on its manual USDC-only path.
  const [tokenSel, setTokenSel] = useState<GToken>("USDC");
  const token: GToken = source === "circle" ? "USDC" : tokenSel;
  const tChains = chainsFor(token);
  const dec = DECIMALS[token];
  const fmt = (n: number) => token === "cirBTC" ? (n === 0 ? "0" : n.toFixed(8).replace(/\.?0+$/, "")) : n.toFixed(2);
  const isMobile = useIsMobile();
  // Deposit into Gateway, Send to any address, or Withdraw = send to your own address on another chain.
  const [tab, setTab] = useState<"deposit" | "send" | "withdraw">("deposit");

  const [bal, setBal] = useState<Record<string, { available: number; pending: number }> | null>(null);
  // USDC sitting in the wallet itself (not yet deposited into Gateway), per chain.
  const [walletBal, setWalletBal] = useState<Record<string, number>>({});
  // A deposit Gateway hasn't credited yet. Kept in localStorage so it survives leaving the page.
  const [arriving, setArriving] = useState<{ chain: string; amount: number; eta: number; baseline: number; token?: GToken } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const arrivingKey = owner ? `flowfi-gw-arriving-${owner.toLowerCase()}` : null;
  useEffect(() => {
    if (!arrivingKey) { setArriving(null); return; }
    try { const p = JSON.parse(localStorage.getItem(arrivingKey) ?? "null"); setArriving(p && p.eta + 15 * 60000 > Date.now() ? p : null); } catch { setArriving(null); }
  }, [arrivingKey]);
  function saveArriving(v: typeof arriving) {
    setArriving(v);
    try { if (arrivingKey) { if (v) localStorage.setItem(arrivingKey, JSON.stringify(v)); else localStorage.removeItem(arrivingKey); } } catch { /* ignore */ }
  }
  const [loadingBal, setLoadingBal] = useState(false);

  const [depChain, setDepChain] = useState("arc");
  const [depAmount, setDepAmount] = useState("");
  const [dStep, setDStep] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [dMsg, setDMsg] = useState<string | null>(null);

  const [fromChain, setFromChain] = useState("arc");
  const [toChain, setToChain] = useState("base");
  const [tAmount, setTAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [tStep, setTStep] = useState<"idle" | "busy" | "pending" | "done" | "error">("idle");
  const [tMsg, setTMsg] = useState<string | null>(null);

  const dep = CHAINS.find((c) => c.key === depChain)!;
  const from = CHAINS.find((c) => c.key === fromChain)!;
  const toEvm = CHAINS.find((c) => c.key === toChain);
  const toSolana = toChain === "solana";
  const to = toEvm ?? SOLANA_DEST;
  // Solana shows as a destination only for Send, with the browser wallet, for USDC/EURC.
  const solanaOk = source === "browser" && tab === "send" && SOLANA_TOKENS.includes(token);
  const toList: { key: string; name: string }[] = solanaOk ? [...tChains, SOLANA_DEST] : tChains;

  useEffect(() => { if (owner) setRecipient(owner); }, [owner]);
  // Keep the picked chains valid for the selected token / tab.
  useEffect(() => {
    const ks = chainsFor(token).map((c) => c.key);
    if (!ks.includes(depChain)) setDepChain("arc");
    const f = ks.includes(fromChain) ? fromChain : "arc";
    if (f !== fromChain) setFromChain(f);
    const toValid = (ks.includes(toChain) || (toChain === "solana" && solanaOk)) && toChain !== f;
    if (!toValid) setToChain(ks.find((k) => k !== f) ?? "arc");
  }, [token, tab, source]);
  useEffect(() => { setDStep("idle"); setDMsg(null); setTStep("idle"); setTMsg(null); setDepAmount(""); setTAmount(""); }, [token]);
  // Solana needs a Solana address; EVM chains default back to your own address.
  useEffect(() => {
    if (toSolana && isAddress(recipient.trim())) setRecipient("");
    if (!toSolana && owner && !isAddress(recipient.trim())) setRecipient(owner);
  }, [toSolana]);
  // Circle Wallet deposits run on Arc only (its other wallets would need ETH for gas).
  useEffect(() => { if (source === "circle" && depChain !== "arc") setDepChain("arc"); }, [source]);

  // Ignore answers that arrive after the token was switched.
  const reqToken = useRef(token);
  reqToken.current = token;

  async function refresh(): Promise<Record<string, { available: number; pending: number }> | null> {
    if (!owner) return null;
    const t = token;
    const list = chainsFor(t);
    setLoadingBal(true);
    Promise.all(list.map(async (c) => {
      try {
        const pc = createPublicClient({ chain: c.chain, transport: http() });
        const raw = await pc.readContract({ address: c.tokens[t]!, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
        return [c.key, Number(raw) / 10 ** DECIMALS[t]] as const;
      } catch { return [c.key, 0] as const; }
    })).then((e) => { if (reqToken.current === t) setWalletBal(Object.fromEntries(e)); });
    try {
      const res = await fetch(`${GATEWAY_API}/v1/balances`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ token: t, sources: list.map((c) => ({ domain: c.domain, depositor: owner })) }),
      });
      const d = await res.json();
      if (reqToken.current !== t) return null;
      const out: Record<string, { available: number; pending: number }> = {};
      for (const c of list) {
        const e = (d?.balances ?? []).find((b: { domain: number }) => Number(b.domain) === c.domain);
        const pending = Number(e?.pendingBatch ?? 0) || 0;
        out[c.key] = { available: Math.max(0, (Number(e?.balance ?? 0) || 0) - pending), pending };
      }
      setBal(out);
      return out;
    } catch { setBal(null); return null; }
    finally { setLoadingBal(false); }
  }

  useEffect(() => {
    setBal(null);
    setWalletBal({});
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [owner, token]);

  // While a deposit is on its way, check often (Arc: every 3 s, other chains: every 15 s) and
  // clear it the moment Gateway credits it.
  useEffect(() => {
    if (!arriving || (arriving.token ?? "USDC") !== token) return;
    const fast = arriving.chain === "arc";
    const tick = async () => {
      setNow(Date.now());
      const out = await refresh();
      const got = out?.[arriving.chain]?.available ?? 0;
      if (got >= arriving.baseline + arriving.amount * 0.99) {
        saveArriving(null);
        setDStep("done");
        setDMsg(`${arriving.amount} ${arriving.token ?? "USDC"} is now in your Gateway balance.`);
      } else if (Date.now() > arriving.eta + 15 * 60000) {
        saveArriving(null);
      }
    };
    const t = setInterval(tick, fast ? 3000 : 15000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [arriving, token]);
  const arrivingHere = arriving && (arriving.token ?? "USDC") === token ? arriving : null;

  const total = bal ? Object.values(bal).reduce((s, x) => s + x.available, 0) : 0;

  async function deposit() {
    if (!owner) return;
    const amountRaw = parseUnits(depAmount.trim(), dec);
    const depToken = dep.tokens.USDC!; // manual paths below are USDC only (Circle Wallet)
    setDStep("busy"); setDMsg(null);
    try {
      if (source === "browser" && USE_KIT) {
        await switchTo(provider!, dep.chain);
        const kit = new UnifiedBalanceKit();
        const adapter = await createKitAdapter(provider!);
        setDMsg("Approve and confirm the deposit in your wallet...");
        await kit.deposit({ from: { adapter, chain: KIT_CHAIN[dep.key] }, amount: depAmount.trim(), token, allowanceStrategy: "approve" });
      } else if (source === "browser") {
        await switchTo(provider!, dep.chain);
        const wc = createWalletClient({ account: owner as `0x${string}`, chain: dep.chain, transport: custom(provider!) });
        const pc = createPublicClient({ chain: dep.chain, transport: http() });
        setDMsg("1/2 Approve USDC in your wallet...");
        const a = await wc.writeContract({ address: depToken, abi: erc20Abi, functionName: "approve", args: [GATEWAY_WALLET, amountRaw] });
        if ((await pc.waitForTransactionReceipt({ hash: a })).status === "reverted") throw new Error("Approval reverted. Nothing was sent.");
        setDMsg("2/2 Confirm the deposit...");
        const h = await wc.writeContract({ address: GATEWAY_WALLET, abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [depToken, amountRaw] });
        if ((await pc.waitForTransactionReceipt({ hash: h })).status === "reverted") throw new Error("Deposit reverted.");
      } else {
        const walletId = circleLive!.walletsByChain[dep.circleCode]?.walletId;
        if (!walletId) throw new Error(`No ${dep.name} Circle wallet on this account.`);
        setDMsg("1/2 Approving USDC...");
        await circleCallAndWait({ walletId, contractAddress: depToken, abiFunctionSignature: "approve(address,uint256)", abiParameters: [GATEWAY_WALLET, amountRaw.toString()] });
        setDMsg("2/2 Depositing...");
        await circleCallAndWait({ walletId, contractAddress: GATEWAY_WALLET, abiFunctionSignature: "deposit(address,uint256)", abiParameters: [depToken, amountRaw.toString()] });
      }
      const etaMs = Date.now() + (dep.slow ? 20 * 60000 : 60000);
      saveArriving({ chain: dep.key, amount: Number(depAmount), eta: etaMs, baseline: bal?.[dep.key]?.available ?? 0, token });
      setDStep("done");
      setDMsg(dep.slow
        ? `Deposit sent. Gateway credits it once ${dep.name} finalizes (about 20 min). You can leave this page; it will appear here automatically.`
        : "Deposit sent. Gateway is crediting it, usually within a minute...");
      setDepAmount("");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setDStep("error"); setDMsg(err.shortMessage || err.message || "Deposit failed.");
    }
  }

  async function transfer() {
    if (!owner) return;
    setTStep("busy"); setTMsg("Getting Circle's fee quote...");
    try {
     let transferId: string;
     if (source === "browser" && USE_KIT) {
      const kit = new UnifiedBalanceKit();
      const adapter = await createKitAdapter(provider!);
      const amt = tAmount.trim();
      setTMsg("Sign the transfer in your wallet...");
      const doSpend = () => kit.spend({
        amount: amt,
        token,
        from: { adapter, allocations: { amount: amt, chain: KIT_CHAIN[from.key] } },
        to: { chain: KIT_CHAIN[to.key], recipientAddress: (tab === "withdraw" ? owner : recipient).trim(), useForwarder: true },
      });
      let res: Awaited<ReturnType<typeof doSpend>>;
      try {
        res = await doSpend();
      } catch (e: unknown) {
        // Circle's fee quote can move between quote and submit ("Insufficient total maxFee ...").
        // Nothing was spent in that case, so ask for a fresh quote once. Only this error, only one retry.
        const m = String((e as { message?: string })?.message ?? "");
        if (!/insufficient total maxfee/i.test(m)) throw e;
        setTMsg("Circle updated its fee. Sign once more in your wallet...");
        res = await doSpend();
      }
      if (!res.transferId) throw new Error("Circle did not return a transfer ID.");
      transferId = res.transferId;
     } else {
      if (!toEvm) throw new Error("This destination needs the browser wallet.");
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ("0x" + Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
      const spec = {
        version: 1,
        sourceDomain: from.domain,
        destinationDomain: toEvm.domain,
        sourceContract: b32(GATEWAY_WALLET),
        destinationContract: b32(GATEWAY_MINTER),
        sourceToken: b32(from.tokens.USDC!),
        destinationToken: b32(toEvm.tokens.USDC!),
        sourceDepositor: b32(owner),
        destinationRecipient: b32((tab === "withdraw" ? owner : recipient).trim()),
        sourceSigner: b32(owner),
        destinationCaller: ZERO32,
        value: parseUnits(tAmount.trim(), 6),
        salt,
        hookData: "0x" as `0x${string}`,
      };

      const estRes = await fetch(`${GATEWAY_API}/v1/estimate?enableForwarder=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: toJSON([{ spec }]),
      });
      const est = await estRes.json().catch(() => ({}));
      if (!estRes.ok) throw new Error(est?.message ?? `Fee quote failed (${estRes.status}).`);
      const bi = est?.body?.[0]?.burnIntent ?? est?.[0]?.burnIntent;
      if (bi?.maxFee == null || bi?.maxBlockHeight == null) throw new Error("Circle returned an incomplete fee quote.");
      const message = { maxBlockHeight: BigInt(bi.maxBlockHeight), maxFee: BigInt(bi.maxFee), spec };
      const typed = { domain: EIP712_DOMAIN, types: EIP712_TYPES, primaryType: "BurnIntent" as const, message };
      const feeUsd = Number(message.maxFee) / 1e6;

      let signature: `0x${string}`;
      if (source === "browser") {
        setTMsg(`Sign the transfer in your wallet (max fee $${feeUsd.toFixed(2)})...`);
        const wc = createWalletClient({ account: owner as `0x${string}`, chain: from.chain, transport: custom(provider!) });
        signature = await wc.signTypedData(typed);
      } else {
        setTMsg(`Signing with your Circle Wallet (max fee $${feeUsd.toFixed(2)})...`);
        const walletId = circleLive!.walletsByChain[from.circleCode]?.walletId;
        if (!walletId) throw new Error(`No ${from.name} Circle wallet on this account.`);
        const circleTyped = { ...typed, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }], ...EIP712_TYPES } };
        signature = (await circlePost({ action: "gatewaySign", walletId, data: circleTyped })).signature;
      }

      setTMsg("Sending to Circle...");
      const tRes = await fetch(`${GATEWAY_API}/v1/transfer?enableForwarder=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: toJSON([{ burnIntent: message, signature }]),
      });
      const tr = await tRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error(tr?.message ?? `Transfer request failed (${tRes.status}).`);
      const tid = tr?.transferId ?? tr?.[0]?.transferId;
      if (!tid) throw new Error("Circle did not return a transfer ID.");
      transferId = tid;
     }

      setTMsg(`Circle is delivering your ${token} on ${to.name}...`);
      const start = Date.now();
      while (Date.now() - start < 300000) {
        const sRes = await fetch(`${GATEWAY_API}/v1/transfer/${transferId}`, { cache: "no-store" });
        const st = await sRes.json().catch(() => ({}));
        const status = String(st?.status ?? "").toLowerCase();
        if (status === "confirmed" || status === "finalized") {
          setTStep("done"); setTMsg(`${tAmount} ${token} delivered on ${to.name}.`); setTAmount(""); setTimeout(refresh, 2000);
          return;
        }
        if (status === "failed" || status === "expired") throw new Error(`Transfer ${status}. Your Gateway balance was not spent.`);
        await sleep(3000);
      }
      setTStep("pending"); setTMsg("Submitted, but delivery isn't confirmed yet. Check your balance on the destination in a few minutes before trying again.");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setTStep("error"); setTMsg(err.shortMessage || err.message || "Transfer failed.");
    }
  }

  const card = { background: "rgba(255,255,255,0.6)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", color: INK, border: "1px solid rgba(255,255,255,0.8)", borderRadius: 24, padding: "1.25rem", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)", display: "flex", flexDirection: "column" as const, gap: 12 };
  const input = { width: "100%", boxSizing: "border-box" as const, height: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "rgba(255,255,255,0.85)" };
  const label = { fontSize: 12, fontWeight: 600, color: MUTED } as const;
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "rgba(61,90,241,0.10)", color: on ? "#FFFFFF" : "#8A93B8", boxShadow: on ? "0 10px 24px -12px rgba(61,90,241,0.8)" : "none", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });
  const note = (st: string, msg: string | null) => msg && st !== "idle" && (
    <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5, background: st === "done" ? "#E7F7EF" : st === "error" ? "#FDECEC" : "rgba(61,90,241,0.08)", color: st === "done" ? "#0B7A53" : st === "error" ? "#B91C1C" : INK }}>{msg}</div>
  );

  // Chain picker: logo buttons instead of a plain <select>.
  const chainPicker = (value: string, onPick: (k: string) => void, disabled: boolean, ariaLabel: string, showBal: false | "gateway" | "wallet" = false, exclude?: string | string[], list: { key: string; name: string }[] = tChains) => (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : Math.min(list.length, 3)}, minmax(0, 1fr))`, gap: 8 }}>
      {list.map((c) => {
        const on = value === c.key;
        const excluded = Array.isArray(exclude) ? exclude.includes(c.key) : c.key === exclude;
        const off = disabled || excluded;
        return (
          <button key={c.key} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => onPick(c.key)}
            style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 52, padding: "8px 10px", borderRadius: 14, textAlign: "left",
              border: on ? `1.5px solid ${BLUE}` : "1px solid rgba(255,255,255,0.95)", background: on ? "rgba(61,90,241,0.10)" : "rgba(255,255,255,0.8)", boxShadow: on ? "none" : "0 3px 10px -6px rgba(36,58,150,0.3)",
              opacity: excluded ? 0.35 : 1, cursor: off ? "not-allowed" : "pointer" }}>
            <ChainLogo chain={c.key as ChainKey} size={26} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{c.name}</span>
              {showBal === "gateway" && <span style={{ fontSize: 12, color: MUTED }}>{bal?.[c.key] ? fmt(bal[c.key].available) : "…"}</span>}
              {showBal === "wallet" && <span style={{ fontSize: 12, color: MUTED }}>{walletBal[c.key] === undefined ? "…" : fmt(walletBal[c.key])}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!hasBrowser && !hasCircle) {
    return (
      <div style={{ ...card, maxWidth: 480, margin: "0 auto", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
        Connect a browser wallet or sign in with Circle Wallet to use Gateway.
      </div>
    );
  }

  const depAmt = Number(depAmount);
  const canDeposit = Number.isFinite(depAmt) && depAmt > 0 && dStep !== "busy";
  const fromAvail = bal?.[fromChain]?.available ?? 0;
  const tAmt = Number(tAmount);
  const validRecipient = toSolana ? isSolanaAddress(recipient.trim()) : isAddress(recipient.trim());

  const isWithdraw = tab === "withdraw";
  const sendRecipientOk = isWithdraw ? true : validRecipient;
  const canSend = Number.isFinite(tAmt) && tAmt > 0 && tAmt < fromAvail && fromChain !== toChain && sendRecipientOk && tStep !== "busy";
  const sendLabel = tStep === "busy" ? "Transferring..." : fromChain === toChain ? "Pick a different destination"
    : !tAmount ? "Enter an amount" : tAmt >= fromAvail ? `Not enough on ${from.name} (fee included)` : !sendRecipientOk ? "Enter a valid address"
    : isWithdraw ? `Withdraw ${tAmount} ${token} to ${to.name}` : `Send ${tAmount} ${token} to ${to.name}`;
  // Gas on Arc is paid in USDC, so deposit MAX leaves a little USDC behind there.
  const depMax = Math.max(0, (walletBal[depChain] ?? 0) - (depChain === "arc" && token === "USDC" ? 0.05 : 0));
  // Gateway's fee comes on top of a transfer, in the token being moved.
  const floorDec = (n: number) => { const m = 10 ** (token === "cirBTC" ? 8 : 2); return (Math.floor(n * m) / m).toFixed(token === "cirBTC" ? 8 : 2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); };
  async function sendMax() {
    const fallback = Math.max(0, fromAvail - (token === "cirBTC" ? 0 : fromChain === "ethereum" ? 1.2 : 0.1));
    if (source !== "browser" || !USE_KIT || fromAvail <= 0) { setTAmount(fallback > 0 ? floorDec(fallback) : ""); return; }
    try {
      const kit = new UnifiedBalanceKit();
      const adapter = await createKitAdapter(provider!);
      const amt = floorDec(fromAvail);
      const dest = toSolana ? (isSolanaAddress(recipient.trim()) ? recipient.trim() : "") : (isWithdraw ? owner! : recipient.trim() || owner!);
      if (!dest) throw new Error("no recipient");
      const est = await kit.estimateSpend({ amount: amt, token, from: { adapter, allocations: { amount: amt, chain: KIT_CHAIN[from.key] } }, to: { chain: KIT_CHAIN[to.key], recipientAddress: dest, useForwarder: true } });
      const fee = est.fees.filter((f) => f.token.toLowerCase() === token.toLowerCase()).reduce((sum, f) => sum + Number(f.amount), 0);
      const max = fromAvail - fee * 1.05;
      setTAmount(max > 0 ? floorDec(max) : "");
    } catch {
      setTAmount(fallback > 0 ? floorDec(fallback) : "");
    }
  }

  const bigAmount = (id: string, value: string, set: (v: string) => void, disabled: boolean, onMax: () => void) => (
    <div style={{ position: "relative" }}>
      <input id={id} aria-label={`Amount in ${token}`} inputMode="decimal" value={value} placeholder={token === "cirBTC" ? "0.0000" : "0.00"} disabled={disabled}
        onChange={(e) => { const v = e.target.value.replace(",", "."); if (new RegExp(`^\\d*\\.?\\d{0,${dec}}$`).test(v)) set(v); }}
        style={{ ...input, height: 68, fontSize: 30, fontWeight: 500, padding: "0 90px 0 18px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.95)", background: "rgba(255,255,255,0.85)", boxShadow: "inset 0 1px 2px rgba(36,58,150,0.06), 0 3px 10px -6px rgba(36,58,150,0.3)" }} />
      <button type="button" onClick={onMax} disabled={disabled}
        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "rgba(61,90,241,0.10)", color: BLUE, fontSize: 13, fontWeight: 700, padding: "7px 12px", borderRadius: 10, cursor: "pointer" }}>MAX</button>
    </div>
  );

  const tabs = (
    <div role="tablist" aria-label="Gateway action" style={{ display: "flex", borderBottom: `1px solid ${LINE}`, margin: "-0.25rem -0.25rem 0" }}>
      {([["deposit", "Deposit"], ["send", "Send"], ["withdraw", "Withdraw"]] as const).map(([k, t]) => {
        const on = tab === k;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { setTab(k); setTStep("idle"); setTMsg(null); }}
            style={{ flex: 1, height: 48, border: "none", background: "transparent", cursor: "pointer", fontSize: 16, fontWeight: on ? 600 : 500, color: on ? BLUE : MUTED, borderBottom: on ? `2.5px solid ${BLUE}` : "2.5px solid transparent", marginBottom: -1 }}>
            {t}
          </button>
        );
      })}
    </div>
  );

  const depositPane = (
    <>
      <span style={label}>From your {source === "browser" ? "wallet" : "Circle Wallet"} on</span>
      {chainPicker(depChain, setDepChain, dStep === "busy", "Deposit from chain", "wallet", source === "circle" ? tChains.map((c) => c.key).filter((k) => k !== "arc") : undefined)}
      {source === "circle" && <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Circle Wallet deposits into Gateway from Arc, where gas is paid in USDC.</p>}
      {bigAmount("gw-dep-amount", depAmount, setDepAmount, dStep === "busy", () => setDepAmount(depMax > 0 ? floorDec(depMax) : ""))}
      {dep.slow && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 12, background: "#FFF4E0", color: "#6A4308", fontSize: 12.5, lineHeight: 1.5 }}>
          <span>Deposits from {dep.name} take about <strong>20 minutes</strong> while {dep.name} finalizes (deposits from Arc are instant). Needs a little {dep.gas} on {dep.name} for gas.</span>
          {onOpenNativeBridge && token === "USDC" && (
            <span>
              Just want your USDC on Arc now?{" "}
              <button type="button" onClick={onOpenNativeBridge}
                style={{ border: "none", background: "none", padding: 0, color: BLUE, fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>
                Use Native Bridge (10–20 sec)
              </button>
            </span>
          )}
        </div>
      )}
      {note(dStep, dMsg)}
      {arrivingHere && (
        <div style={{ fontSize: 12.5, color: MUTED }}>
          {arrivingHere.eta > now
            ? `Arriving in about ${Math.max(1, Math.ceil((arrivingHere.eta - now) / 60000))} min (${new Date(arrivingHere.eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).`
            : "Almost there, still checking..."}
        </div>
      )}
      <button type="button" onClick={deposit} disabled={!canDeposit} style={primary(canDeposit)}>{dStep === "busy" ? "Depositing..." : !depAmount ? "Enter an amount" : `Deposit ${depAmount} ${token}`}</button>
      <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
        {source === "circle" ? "Your Gateway balance counts toward the Circle Wallet limit. " : ""}Your wallet pays the network fee for the deposit{dep.key !== "arc" ? ` in ${dep.gas}` : ""}.
      </p>
    </>
  );

  const sendPane = (
    <>
      <span style={label}>From Gateway balance on</span>
      {chainPicker(fromChain, (k) => { setFromChain(k); if (k === toChain) setToChain(tChains.find((c) => c.key !== k)!.key); }, tStep === "busy", "Send from chain", "gateway")}
      <span style={label}>{isWithdraw ? "To your wallet on" : "To"}</span>
      {chainPicker(toChain, setToChain, tStep === "busy", "Send to chain", false, fromChain, toList)}
      {bigAmount("gw-t-amount", tAmount, setTAmount, tStep === "busy", sendMax)}
      {isWithdraw ? (
        <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(61,90,241,0.07)", fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
          Goes to your own address on {to.name}: <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", color: INK }}>{owner?.slice(0, 6)}…{owner?.slice(-4)}</span>
        </div>
      ) : (
        <>
          <label htmlFor="gw-recipient" style={label}>Recipient on {to.name}</label>
          <input id="gw-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={toSolana ? "Solana address" : "0x..."} spellCheck={false} disabled={tStep === "busy"}
            style={{ ...input, height: 50, borderRadius: 14, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13 }} />
        </>
      )}
      {note(tStep, tMsg)}
      <button type="button" onClick={transfer} disabled={!canSend} style={primary(canSend)}>{sendLabel}</button>
      {toSolana && <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>The Solana address needs a {token} token account. Wallets like Phantom create it the first time they receive {token}.</p>}
      <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>Circle delivers on {to.name}, so you need no gas there. Circle's fee comes from your Gateway balance on top of the amount.</p>
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040, margin: "0 auto" }}>
      <div role="group" aria-label="Wallet" style={{ display: "flex", gap: 2, padding: 4, borderRadius: 16, width: "100%", maxWidth: 420, alignSelf: "center", background: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.9)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 6px 18px -12px rgba(36,58,150,0.4)" }}>
        {(["browser", "circle"] as const).map((k) => {
          const on = source === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setSource(k)}
              style={{ flex: 1, height: 42, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 15, fontWeight: on ? 600 : 500, background: on ? "#FFFFFF" : "transparent", color: on ? BLUE : PAGE_MUTED, boxShadow: on ? "0 2px 8px -2px rgba(36,58,150,0.25)" : "none" }}>
              {k === "browser" ? "Browser wallet" : "Circle Wallet"}
            </button>
          );
        })}
      </div>

      {owner && source === "browser" && (
        <div role="radiogroup" aria-label="Token" style={{ display: "flex", gap: 6, alignSelf: "center", padding: 4, borderRadius: 16, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 6px 18px -12px rgba(36,58,150,0.4)" }}>
          {TOKEN_LIST.map((t) => {
            const on = token === t;
            return (
              <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setTokenSel(t)} disabled={dStep === "busy" || tStep === "busy"}
                style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14.5, fontWeight: on ? 700 : 500, background: on ? "#FFFFFF" : "transparent", color: on ? BLUE : PAGE_MUTED, boxShadow: on ? "0 2px 8px -2px rgba(36,58,150,0.25)" : "none" }}>
                <TokenLogo symbol={t} size={22} /> {t}
              </button>
            );
          })}
        </div>
      )}

      {!owner ? (
        <div style={{ ...card, maxWidth: 480, width: "100%", alignSelf: "center", alignItems: "center", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
          {source === "circle" ? "Sign in with Circle Wallet to use Gateway with it." : "Connect a browser wallet to use Gateway with it."}
          {onConnect && <button type="button" onClick={onConnect} style={{ ...primary(true), maxWidth: 260 }}>{source === "circle" ? "Sign in with Circle Wallet" : "Connect wallet"}</button>}
        </div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 0.95fr) minmax(0, 1.05fr)", gap: 20, alignItems: "start" }}>
        <section style={{ ...card, padding: "1.5rem", gap: 16, background: "linear-gradient(135deg, #3F63F2 0%, #3D5AF1 45%, #6C8BFF 100%)", border: "1px solid rgba(255,255,255,0.3)", color: "#FFFFFF", backdropFilter: "none", boxShadow: "0 24px 50px -26px rgba(61,90,241,0.8), inset 0 1px 0 rgba(255,255,255,0.3)", position: isMobile ? "static" : "sticky", top: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, fontWeight: 600 }}><TokenLogo symbol={token} size={34} /> Unified {token} balance <Layers size={16} style={{ opacity: 0.85 }} /></span>
            <button type="button" aria-label="Refresh" onClick={() => { refresh(); }} style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.08)", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <RefreshCw size={16} />
            </button>
          </div>
          <div style={{ fontFamily: "'Bricolage Grotesque', 'Geist', system-ui, sans-serif", fontSize: isMobile ? 52 : 72, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {bal === null ? (loadingBal ? "…" : "—")
              : token === "cirBTC" ? <>{fmt(total)} <span style={{ fontSize: "0.4em", fontWeight: 700 }}>cirBTC</span></>
              : `${token === "EURC" ? "€" : "$"}${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {tChains.map((c) => {
              const has = (bal?.[c.key]?.available ?? 0) > 0;
              return (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: has ? "#FFFFFF" : "rgba(255,255,255,0.9)", boxShadow: "0 6px 14px -10px rgba(10,20,80,0.6)", color: INK }}>
                  <ChainLogo chain={c.key as ChainKey} size={28} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: MUTED }}>{c.name}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: has ? INK : "#9AA1B5", fontVariantNumeric: "tabular-nums" }}>{bal?.[c.key] ? fmt(bal[c.key].available) : "…"}</span>
                    {arrivingHere?.chain === c.key && <span style={{ fontSize: 11, color: BLUE, fontWeight: 600 }}>+{fmt(arrivingHere.amount)} arriving</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.88)", lineHeight: 1.5 }}>Spend it on any of these chains in seconds. Circle delivers on the destination, so you need no gas there.</div>
        </section>

        <section style={{ ...card, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.95)", padding: "1.25rem 1.5rem 1.5rem", gap: 14, boxShadow: "0 16px 40px -24px rgba(36,58,150,0.35), inset 0 1px 0 rgba(255,255,255,0.9)" }}>
          {tabs}
          {tab === "deposit" ? depositPane : sendPane}
        </section>
      </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits, parseAbiItem, decodeAbiParameters } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { useIsMobile } from "../useIsMobile";
import { TokenIcon } from "./TokenIcon";
import { TrendingUp, Droplet, BarChart3, RefreshCw, type LucideIcon } from "lucide-react";
import { showToast } from "../toast";
import { waitForSuccess } from "../txHelpers";

const FACTORY_CONTRACT = "0x23782643650D73b2Bb145B9145D62D743bF25CB0" as `0x${string}`; // ArcFactoryV2 v2 — legacy, pools created here keep working, no new pools go here
const FACTORY_CONTRACT_V3 = "0x5ee0c6cc6879728a4835826D87b28702f8993559" as `0x${string}`; // ArcFactoryV2 v3 — legacy, same reasoning as v2 (superseded by v4 for new pools)
const FACTORY_CONTRACT_V4 = "0x57B451D60F09222C2bb6c828FFE3703069A532Ed" as `0x${string}`; // ArcFactoryV2 v4 (original) — legacy now, kept scanned only so real liquidity still sitting in these pools stays visible/withdrawable until it's migrated to v4b
const FACTORY_CONTRACT_V4B = "0xa42c3bDcd385350880165120fE7E72e43733f70B" as `0x${string}`; // ArcFactoryV2 v4b — legacy now, kept scanned only so any liquidity in these pools stays visible/withdrawable
const FACTORY_CONTRACT_V4C = "0xD2dC496dcf4e6D8c9CFc710AC5C9A6Dc941CBbB0" as `0x${string}`; // ArcFactoryV2 v4c — addLiquidity now takes amountAMin/amountBMin (slippage protection) and pulls only the ratio-matching amount instead of the full desired amount (no more silent excess donation); this is the current factory for anything new
const LEGACY_AMM_CONTRACT = "0x01ddb4902e2F22f6124Ec685540C424d1BB75E0C" as `0x${string}`;
const STABLE_SYMBOLS = new Set(["USDC", "EURC", "USYC"]);

const KNOWN_TOKENS: { symbol: string; address: `0x${string}`; color: string }[] = [
  { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", color: "#2563eb" },
  { symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", color: "#7c3aed" },
  { symbol: "USYC", address: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C", color: "#f59e0b" },
  { symbol: "ARCC", address: "0x215D82093892AA24b2901aeb4fcCca933346De18", color: "#10b981" },
  { symbol: "cirBTC", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", color: "#f97316" },
];

// The only pairs FlowFi actually curates and shows on the Pools page —
// anything else (e.g. pools someone created for a random launched token
// before v4 locked createPool down to onlyOwner) is real on-chain data,
// just not something we surface in this UI.
const CURATED_PAIR_LIST: readonly [`0x${string}`, `0x${string}`][] = [
  ["0x3600000000000000000000000000000000000000", "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"], // USDC/EURC
  ["0x3600000000000000000000000000000000000000", "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF"], // USDC/cirBTC
  ["0x3600000000000000000000000000000000000000", "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C"], // USDC/USYC
  ["0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C"], // EURC/USYC
  ["0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF"], // EURC/cirBTC
];
const CURATED_PAIRS = new Set([
  ["0x3600000000000000000000000000000000000000", "0x89b50855aa3be2f677cd6303cec089b5f319d72a"].sort().join("_"), // USDC/EURC
  ["0x3600000000000000000000000000000000000000", "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf"].sort().join("_"), // USDC/cirBTC
  ["0x3600000000000000000000000000000000000000", "0xe9185f0c5f296ed1797aae4238d26ccabeadb86c"].sort().join("_"), // USDC/USYC
  ["0x89b50855aa3be2f677cd6303cec089b5f319d72a", "0xe9185f0c5f296ed1797aae4238d26ccabeadb86c"].sort().join("_"), // EURC/USYC
  ["0x89b50855aa3be2f677cd6303cec089b5f319d72a", "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf"].sort().join("_"), // EURC/cirBTC
]);
function isCuratedPair(addrA: string, addrB: string): boolean {
  return CURATED_PAIRS.has([addrA.toLowerCase(), addrB.toLowerCase()].sort().join("_"));
}

// Specific pool addresses FlowFi's UI must never surface, regardless of
// which pair they hold. This is a UI-only block — the pool contract itself
// has no admin pause (by design, see SECURITY.md), so this can't stop
// someone who already has the address from interacting with it directly.
// What it guarantees is that FlowFi itself never points a user at it again.
const BLOCKED_POOL_ADDRESSES = new Set([
  "0xe182de122c0f9f8472d0e67dd6279796b3e18358", // pre-v4 permissionless USDC/EURC pool, reverts with NotPermissioned()
].map(a => a.toLowerCase()));

const FACTORY_ABI = [
  { type: "function", name: "createPool", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "pool", type: "address" }] },
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "allPoolsLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allPools", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_ABI = [
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "removeLiquidity", stateMutability: "nonpayable", inputs: [{ name: "shareAmount", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getShareValue", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }] },
  { type: "function", name: "shares", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenB", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

// v2's ArcPool never had a deadline param on addLiquidity/removeLiquidity/
// swap (added in v3) — reusing the v3/v4 ABI on a v2 pool encodes the wrong
// function selector entirely, which doesn't match anything on that contract
// and reverts immediately with no message. This is the real, confirmed
// shape of what v2 actually deployed.
const V2_POOL_ABI = [
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "removeLiquidity", stateMutability: "nonpayable", inputs: [{ name: "shareAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getShareValue", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }] },
  { type: "function", name: "shares", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenB", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

// v4c: addLiquidity gained slippage protection (amountAMin/amountBMin) and
// now only pulls the ratio-matching amount instead of the full desired
// amount — a genuinely different selector from v3/v4/v4b's 3-arg version.
const V4C_POOL_ABI = [
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "amountADesired", type: "uint256" }, { name: "amountBDesired", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "removeLiquidity", stateMutability: "nonpayable", inputs: [{ name: "shareAmount", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getShareValue", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }] },
  { type: "function", name: "shares", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenB", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

const LEGACY_ABI = [
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "usdcAmount", type: "uint256" }, { name: "eurcAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "removeLiquidity", stateMutability: "nonpayable", inputs: [{ name: "shareAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { type: "function", name: "getShareValue", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ name: "usdcAmount", type: "uint256" }, { name: "eurcAmount", type: "uint256" }] },
  { type: "function", name: "shares", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const SWAP_EVENT = parseAbiItem("event Swap(address indexed trader, bool aToB, uint256 amountIn, uint256 amountOut)");

interface Props {
  provider: EIP1193Provider;
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onRefresh: () => void;
}

interface PoolInfo {
  poolAddress: `0x${string}`;
  addressA: `0x${string}`;
  addressB: `0x${string}`;
  symbolA: string;
  symbolB: string;
  colorA: string;
  colorB: string;
  // Which contract shape this pool actually is — determines both the ABI to
  // call it with AND which pool to prefer when the same pair exists on
  // multiple factories. v2's ArcPool has addLiquidity(uint256,uint256) — NO
  // deadline param; v3/v4 added a third deadline param. Calling a v2 pool
  // with the 3-arg selector doesn't match any function on that contract and
  // reverts immediately with empty data — this was a real, confirmed bug.
  abiVersion: "legacy" | "v2" | "v3v4" | "v4c";
  // Precise factory that created this pool — used only to rank which pool
  // to prefer when the same pair exists on more than one factory. abiVersion
  // groups v3+v4 together (same call signature) but v3 and v4 are NOT
  // equally preferred: a v3 pool that predates the onlyOwner lock could be
  // an untrusted, permissionlessly-created leftover. Confirmed real bug:
  // a brand-new v4 pool was silently shadowed by an old, broken v3 pool for
  // the same pair because the old ranking treated v3 and v4 as one tier.
  sourceFactory: "legacy" | "v2" | "v3" | "v4" | "v4b" | "v4c";
}

interface PoolMetrics {
  tvl: number | null;
  swapCount7d: number;
  volume7d: number | null;
  fees7d: number | null;
  apr: number | null;
  shape: number[];
  logsUnavailable: boolean;
}

async function switchToArc(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    } else throw e;
  }
}

function tokenMetaSync(addr: string) {
  const known = KNOWN_TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase());
  if (known) return known;
  return { symbol: addr.slice(0, 6), address: addr as `0x${string}`, color: "#4B5563" };
}

async function resolveTokenSymbol(addr: string, client: ReturnType<typeof createPublicClient>) {
  const known = KNOWN_TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase());
  if (known) return known.symbol;
  try {
    return await client.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: "symbol" });
  } catch {
    return addr.slice(0, 6);
  }
}

const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

function tokenDecimalsSync(addr: string): number {
  // Best-guess used only until the real on-chain decimals() resolves (see resolveTokenDecimals
  // below, which is authoritative and always queries the chain — never trust this alone).
  if (addr.toLowerCase() === CIRBTC_ADDRESS.toLowerCase()) return 8; // BTC convention, matches CircleWallet.tsx
  const known = KNOWN_TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase());
  return known ? 6 : 18;
}

async function resolveTokenDecimals(addr: string, client: ReturnType<typeof createPublicClient>): Promise<number> {
  // Always ask the contract directly — don't shortcut based on KNOWN_TOKENS membership.
  // A wrong assumption here (e.g. cirBTC previously assumed 6 like the other Circle assets,
  // when CircleWallet.tsx elsewhere correctly treats it as 8) silently breaks reserve display,
  // swap amounts, and TVL for that token, the same class of bug the launched-token decimals fix addressed.
  try {
    const d = await client.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: "decimals" });
    return Number(d);
  } catch {
    return tokenDecimalsSync(addr);
  }
}

const SWAP_EVENT_TOPIC0 = "0xbfd50a04f1e6e4aee344f5d0e7f15d74d0dbb58cd1f711daa6463094ca9508cd" as const; // keccak256("Swap(address,bool,uint256,uint256)")

// Same shape as what client.getLogs({ event: SWAP_EVENT }) returns, but only
// the two fields anything downstream actually reads — kept minimal so this
// fallback source is a drop-in replacement regardless of where the logs
// came from.
type SwapLogLike = { args: { amountIn?: bigint; aToB?: boolean } };

async function fetchSwapLogsFromArcscan(poolAddress: `0x${string}`, currentBlock: bigint): Promise<{ logs: SwapLogLike[]; ok: boolean }> {
  // Arcscan's getLogs rejects a fromBlock/toBlock span wider than roughly
  // 10,000 blocks (documented) rather than silently truncating — asking
  // for the whole chain (fromBlock=0) was being flat-out refused, which is
  // the real reason this fallback wasn't actually recovering anything.
  const windows = [9000n, 4000n, 1000n];
  for (const w of windows) {
    const fromBlock = currentBlock > w ? currentBlock - w : 0n;
    try {
      const url = `/api/arcscan-proxy?module=logs&action=getLogs&address=${poolAddress}&topic0=${SWAP_EVENT_TOPIC0}&fromBlock=${fromBlock}&toBlock=latest`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.status !== "1" && json?.message !== "OK") continue; // Blockscout signals a rejected range this way, not just a bad HTTP status
      const items: { data: `0x${string}`; topics: string[] }[] = json?.result ?? [];
      if (!Array.isArray(items)) continue;
      const logs: SwapLogLike[] = items.map((item) => {
        try {
          const [aToB, amountIn] = decodeAbiParameters(
            [{ type: "bool" }, { type: "uint256" }, { type: "uint256" }],
            item.data
          );
          return { args: { amountIn: amountIn as bigint, aToB: aToB as boolean } };
        } catch {
          return { args: {} };
        }
      });
      return { logs, ok: true };
    } catch {
      continue;
    }
  }
  return { logs: [], ok: false };
}

async function fetchSwapLogsWithFallback(
  client: ReturnType<typeof createPublicClient>,
  poolAddress: `0x${string}`,
  currentBlock: bigint
): Promise<{ logs: SwapLogLike[]; ok: boolean }> {
  // Arc Testnet's public RPC has a confirmed, real reliability problem with
  // eth_getLogs specifically — trying it first (across up to 5 shrinking
  // block windows) before falling back to Arcscan meant waiting out several
  // near-guaranteed failures on every single pool, which is what was making
  // the page slow. Arcscan's own indexed logs endpoint is the one we've
  // actually confirmed works, so it goes first now; the RPC windows are
  // kept only as a fallback in case Arcscan itself has a bad moment.
  const fromArcscan = await fetchSwapLogsFromArcscan(poolAddress, currentBlock);
  if (fromArcscan.ok) return fromArcscan;

  const windows = [50000n, 20000n, 5000n, 1000n, 200n];
  for (const w of windows) {
    const fromBlock = currentBlock > w ? currentBlock - w : 0n;
    try {
      const logs = await client.getLogs({ address: poolAddress, event: SWAP_EVENT, fromBlock, toBlock: "latest" });
      return { logs: logs.map((l) => ({ args: { amountIn: l.args.amountIn, aToB: l.args.aToB } })), ok: true };
    } catch {
      continue;
    }
  }
  return { logs: [], ok: false };
}

// A fixed 4-decimal display works fine for 6-decimal stablecoins, but a
// real, non-zero cirBTC balance like 0.00001 (raw: 1000 at 8 decimals)
// rounds straight to "0.0000" at that precision — looking exactly like the
// deposit never happened, even though Arcscan confirms the transfer
// succeeded. Tokens with 8+ decimals need more display precision to show
// realistically small amounts at all.
function reservePrecision(tokenDecimals: number): number {
  return tokenDecimals >= 8 ? 8 : 4;
}

function formatCompact(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function LiquidityPools({ provider, address, onRefresh }: Props) {
  const isMobile = useIsMobile();
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  const [poolMetrics, setPoolMetrics] = useState<Record<string, PoolMetrics>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [filterTab, setFilterTab] = useState<"all" | "stable" | "volatile">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"apr" | "tvl" | "volume">("apr");
  const [resolvedSymbols, setResolvedSymbols] = useState<Record<string, { a?: string; b?: string }>>({});

  const handlePoolMetrics = useCallback((poolAddress: string, m: PoolMetrics) => {
    setPoolMetrics(prev => ({ ...prev, [poolAddress]: m }));
  }, []);

  const handleSymbolResolved = useCallback((poolAddress: string, side: "a" | "b", symbol: string) => {
    setResolvedSymbols(prev => ({ ...prev, [poolAddress]: { ...prev[poolAddress], [side]: symbol } }));
  }, []);

  const metricsValues = Object.values(poolMetrics);
  const aggregate = {
    tvl: metricsValues.reduce((s, m) => s + (m.tvl ?? 0), 0),
    volume: metricsValues.reduce((s, m) => s + (m.volume7d ?? 0), 0),
    fees: metricsValues.reduce((s, m) => s + (m.fees7d ?? 0), 0),
    avgApr: (() => {
      const aprs = metricsValues.map(m => m.apr).filter((a): a is number => a !== null);
      return aprs.length ? aprs.reduce((a, b) => a + b, 0) / aprs.length : null;
    })(),
  };
  const totalTvl = metricsValues.length > 0 ? aggregate.tvl : null;
  // Only curated, deduplicated pools ever get a <PoolRow> mounted (see
  // visiblePools below) — so loadingTvl must compare against that count,
  // not the raw pools.length (which includes every pool ever scanned from
  // the factories, most of which are filtered out and never call
  // onMetrics). Comparing against the raw count meant this never resolved:
  // poolMetrics could never catch up to a number it wasn't building toward,
  // so TVL/Volume stayed stuck on "..." forever.
  const curatedPoolCount = (() => {
    const seen = new Set<string>();
    let n = 0;
    for (const p of pools) {
      if (!isCuratedPair(p.addressA, p.addressB)) continue;
      const pairKey = [p.addressA.toLowerCase(), p.addressB.toLowerCase()].sort().join("_");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      n++;
    }
    return n;
  })();
  const loadingTvl = curatedPoolCount > 0 && Object.keys(poolMetrics).length < curatedPoolCount;

  const loadPools = useCallback(async () => {
    setLoadingPools(true);
    const legacyPool: PoolInfo = {
      poolAddress: LEGACY_AMM_CONTRACT,
      addressA: KNOWN_TOKENS[0].address, addressB: KNOWN_TOKENS[1].address,
      symbolA: "USDC", symbolB: "EURC",
      colorA: "#2563eb", colorB: "#7c3aed",
      abiVersion: "legacy",
      sourceFactory: "legacy",
    };
    setPools([legacyPool]);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const factories: { addr: `0x${string}`; abiVersion: PoolInfo["abiVersion"]; sourceFactory: PoolInfo["sourceFactory"] }[] = [
        { addr: FACTORY_CONTRACT, abiVersion: "v2", sourceFactory: "v2" },
        { addr: FACTORY_CONTRACT_V3, abiVersion: "v3v4", sourceFactory: "v3" },
        { addr: FACTORY_CONTRACT_V4, abiVersion: "v3v4", sourceFactory: "v4" },
        { addr: FACTORY_CONTRACT_V4B, abiVersion: "v3v4", sourceFactory: "v4b" },
        { addr: FACTORY_CONTRACT_V4C, abiVersion: "v4c", sourceFactory: "v4c" },
      ];

      // We already know exactly which pairs we curate — ask each factory's
      // own getPool(a, b) mapping directly instead of paging through every
      // pool it has ever created (a factory like v2 has ~50 pools from
      // pre-curation testing, almost none of them relevant). This is 25
      // parallel reads total instead of potentially hundreds of sequential
      // ones, and it's what actually made the page slow to load.
      const lookups = factories.flatMap(f =>
        CURATED_PAIR_LIST.map(([a, b]) => ({ factory: f, a, b }))
      );
      const results = await Promise.all(lookups.map(async ({ factory, a, b }) => {
        try {
          const poolAddr = await client.readContract({ address: factory.addr, abi: FACTORY_ABI, functionName: "getPool", args: [a, b] });
          if (!poolAddr || poolAddr === "0x0000000000000000000000000000000000000000") return null;
          if (BLOCKED_POOL_ADDRESSES.has(poolAddr.toLowerCase())) return null;
          const metaA = tokenMetaSync(a);
          const metaB = tokenMetaSync(b);
          return { poolAddress: poolAddr, addressA: a, addressB: b, symbolA: metaA.symbol, symbolB: metaB.symbol, colorA: metaA.color, colorB: metaB.color, abiVersion: factory.abiVersion, sourceFactory: factory.sourceFactory } as PoolInfo;
        } catch {
          return null;
        }
      }));
      const found = results.filter((d): d is PoolInfo => d !== null);
      setPools(prev => [...prev, ...found]);
    } catch {
      /* keep whatever pools already loaded */
    } finally {
      setLoadingPools(false);
    }
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);


  const visiblePools = pools
    .filter(p => {
      const symA = resolvedSymbols[p.poolAddress]?.a ?? p.symbolA;
      const symB = resolvedSymbols[p.poolAddress]?.b ?? p.symbolB;
      const stable = STABLE_SYMBOLS.has(symA) && STABLE_SYMBOLS.has(symB);
      if (filterTab === "stable" && !stable) return false;
      if (filterTab === "volatile" && stable) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        if (!`${symA}${symB}`.toLowerCase().includes(needle) && !p.poolAddress.toLowerCase().includes(needle)) return false;
      }
      return true;
    })
    .filter((p, _i, arr) => {
      // Same pair can exist on both the old legacy AMM and a newer factory
      // pool — show it once, preferring the non-legacy one.
      const pairKey = [p.addressA.toLowerCase(), p.addressB.toLowerCase()].sort().join("_");
      const candidates = arr.filter(o => [o.addressA.toLowerCase(), o.addressB.toLowerCase()].sort().join("_") === pairKey);
      if (candidates.length === 1) return true;
      const rank = (c: PoolInfo) => c.sourceFactory === "v4c" ? 0 : c.sourceFactory === "v4b" ? 1 : c.sourceFactory === "v4" ? 2 : c.sourceFactory === "v3" ? 3 : c.sourceFactory === "v2" ? 4 : 5;
      const preferred = [...candidates].sort((a, b) => rank(a) - rank(b))[0];
      return p.poolAddress === preferred.poolAddress;
    })
    .sort((a, b) => {
      const ma = poolMetrics[a.poolAddress]; const mb = poolMetrics[b.poolAddress];
      const key = sortBy === "apr" ? "apr" : sortBy === "tvl" ? "tvl" : "volume7d";
      const va = (ma?.[key as keyof PoolMetrics] as number | null) ?? -1;
      const vb = (mb?.[key as keyof PoolMetrics] as number | null) ?? -1;
      return vb - va;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: isMobile ? 460 : 960, margin: isMobile ? undefined : "0 auto", background: "#F7F4FF" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={() => { setPoolMetrics({}); setRefreshNonce(n => n + 1); }} title="Refetch on-chain data for every pool"
          style={{ height: 36, display: "flex", alignItems: "center", gap: 6, padding: "0 16px", borderRadius: 999, border: "1px solid #EDE9FE", background: "#ffffff", color: "#6D5EF7", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
        <StatCard label="TVL" value={loadingTvl ? "..." : totalTvl !== null ? formatCompact(totalTvl) : "$0.00"} changePct={null} isMobile={isMobile} icon={TrendingUp} />
        <StatCard label="POOLS" value={String(visiblePools.length)} sub="Active pools" isMobile={isMobile} icon={Droplet} />
        <StatCard label="RECENT VOLUME" value={loadingTvl ? "..." : metricsValues.length > 0 ? formatCompact(aggregate.volume) : "$0.00"} changePct={null} isMobile={isMobile} icon={BarChart3} />
      </div>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: 10 }}>
        {pools.length > 1 && (
        <div style={{ display: "flex", gap: 6, background: "#f5f3ff", borderRadius: 999, padding: 4, width: isMobile ? "100%" : undefined }}>
          {(["all", "stable", "volatile"] as const).map(tab => (
            <button key={tab} onClick={() => setFilterTab(tab)}
              style={{ flex: isMobile ? 1 : undefined, padding: "0.4rem 0.9rem", borderRadius: 999, border: "none", background: filterTab === tab ? "#EDE9FE" : "transparent", color: filterTab === tab ? "#5B21B6" : "#6B7280", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
              {tab}
            </button>
          ))}
        </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="Search pair or address" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? "100%" : 200, flexShrink: 0, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.55rem 0.8rem", fontSize: 12, color: "#111827", outline: "none" }} />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.55rem 0.6rem", fontSize: 12, color: "#111827" }}>
            <option value="apr">APR</option>
            <option value="tvl">TVL</option>
            <option value="volume">Volume</option>
          </select>
        </div>
      </div>



      <div style={{ background: "#FFFFFF", border: "1px solid #EDE9FE", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(109,94,247,0.08)", padding: "8px 0" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid rgba(124,58,237,0.08)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>All Pools</div>
        </div>
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 80px 72px", gap: 10, padding: "8px 20px", borderBottom: "1px solid #EDE9FE" }}>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>POOL</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>TYPE</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", textAlign: "right" }}>TVL</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", textAlign: "right" }}>APY</div>
            <div />
          </div>
        )}

        {loadingPools && <div style={{ fontSize: 12, color: "#334155", padding: "1rem 1.25rem" }}>Loading pools...</div>}
        {!loadingPools && visiblePools.length === 0 && <div style={{ fontSize: 12, color: "#334155", padding: "1rem 1.25rem" }}>No pools match your filters.</div>}

        {!loadingPools && visiblePools.map((pool, i) => (
          <div key={pool.poolAddress} style={{ borderTop: i === 0 ? "none" : "1px solid rgba(124,58,237,0.08)" }}>
            <PoolRow pool={pool} provider={provider} address={address}
              expanded={expandedPool === pool.poolAddress}
              onToggle={() => setExpandedPool(expandedPool === pool.poolAddress ? null : pool.poolAddress)}
              onRefresh={onRefresh}
              onMetrics={handlePoolMetrics}
              onSymbolResolved={handleSymbolResolved}
              refreshNonce={refreshNonce} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, changePct, isMobile, icon: Icon }: { label: string; value: string; sub?: string; changePct?: number | null; isMobile: boolean; icon: LucideIcon }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #EDE9FE", borderRadius: 16, padding: isMobile ? "16px 18px" : "20px 22px", boxShadow: "0 1px 3px rgba(109,94,247,0.08)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase" }}>{label}</div>
        <div className="flowfi-mono" style={{ fontSize: isMobile ? 22 : 28, fontWeight: 800, color: "#111827", marginTop: 6, lineHeight: 1.1 }}>{value}</div>
        {sub !== undefined ? (
          <div style={{ fontSize: 12, fontWeight: 500, color: "#9CA3AF", marginTop: 6 }}>{sub}</div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 500, marginTop: 6, color: changePct === null || changePct === undefined ? "#9CA3AF" : changePct >= 0 ? "#16A34A" : "#DC2626" }}>
            {changePct === null || changePct === undefined ? "— 24h change" : `${changePct >= 0 ? "↑" : "↓"} ${Math.abs(changePct).toFixed(2)}% 24h change`}
          </div>
        )}
      </div>
      <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#F3EFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={18} color="#6D5EF7" />
      </div>
    </div>
  );
}

function PoolRow({ pool, provider, address, expanded, onToggle, onRefresh, onMetrics, onSymbolResolved, refreshNonce }: {
  pool: PoolInfo; provider: EIP1193Provider; address: string;
  expanded: boolean; onToggle: () => void; onRefresh: () => void;
  onMetrics: (poolAddress: string, m: PoolMetrics) => void;
  onSymbolResolved: (poolAddress: string, side: "a" | "b", symbol: string) => void;
  refreshNonce: number;
}) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<"swap" | "add" | "remove">("add");
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [removePct, setRemovePct] = useState(50);
  const [state, setState] = useState<"idle" | "approving1" | "approving2" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reserves, setReserves] = useState<{ a: string; b: string } | null>(null);
  const [myShare, setMyShare] = useState<{ a: string; b: string; pct: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PoolMetrics>({ tvl: null, swapCount7d: 0, volume7d: null, fees7d: null, apr: null, shape: [], logsUnavailable: false });

  const [swapDirAtoB, setSwapDirAtoB] = useState(true);
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapEstOut, setSwapEstOut] = useState("0.00");
  const [swapState, setSwapState] = useState<"idle" | "approving" | "swapping" | "done" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);

  const [resolvedSymbolA, setResolvedSymbolA] = useState(pool.symbolA);
  const [resolvedSymbolB, setResolvedSymbolB] = useState(pool.symbolB);
  const [decimalsA, setDecimalsA] = useState(tokenDecimalsSync(pool.addressA));
  const [decimalsB, setDecimalsB] = useState(tokenDecimalsSync(pool.addressB));

  // Same real risk as the main Swap page: this pool has no built-in
  // awareness of real-world prices, only the ratio of whatever's actually
  // deposited. A thin pool like this has no arbitrage activity correcting
  // that ratio toward reality, so comparing against real EUR/USD and BTC/USD
  // is the only thing warning a user before an unknowingly bad trade.
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);
  const [btcUsdRate, setBtcUsdRate] = useState<number | null>(null);
  useEffect(() => {
    const needsEur = resolvedSymbolA === "EURC" || resolvedSymbolB === "EURC";
    const needsBtc = resolvedSymbolA === "cirBTC" || resolvedSymbolB === "cirBTC";
    if (needsEur) {
      fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=USD").then(r => r.json()).then(d => { if (d.rates?.USD) setEurUsdRate(d.rates.USD); }).catch(() => {});
    }
    if (needsBtc) {
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd").then(r => r.json()).then(d => { if (d?.bitcoin?.usd) setBtcUsdRate(d.bitcoin.usd); }).catch(() => {});
    }
  }, [resolvedSymbolA, resolvedSymbolB]);

  function usdValuePerUnit(symbol: string): number | null {
    if (symbol === "USDC" || symbol === "USYC") return 1;
    if (symbol === "EURC") return eurUsdRate;
    if (symbol === "cirBTC") return btcUsdRate;
    return null;
  }
  const expectedSwapRate = (() => {
    const inVal = usdValuePerUnit(swapDirAtoB ? resolvedSymbolA : resolvedSymbolB);
    const outVal = usdValuePerUnit(swapDirAtoB ? resolvedSymbolB : resolvedSymbolA);
    return inVal !== null && outVal !== null ? inVal / outVal : null;
  })();
  const poolSwapRate = swapAmountIn && Number(swapAmountIn) > 0 && swapEstOut !== "0.00" ? Number(swapEstOut) / Number(swapAmountIn) : null;
  const swapPriceDeviationPct = poolSwapRate !== null && expectedSwapRate !== null ? Math.abs(poolSwapRate - expectedSwapRate) / expectedSwapRate * 100 : null;
  const swapPriceStale = swapPriceDeviationPct !== null && swapPriceDeviationPct > 1.5;

  const tokenAInfo = { symbol: resolvedSymbolA, address: pool.addressA, color: pool.colorA };
  const tokenBInfo = { symbol: resolvedSymbolB, address: pool.addressB, color: pool.colorB };
  const abi = pool.abiVersion === "legacy" ? LEGACY_ABI : pool.abiVersion === "v2" ? V2_POOL_ABI : pool.abiVersion === "v4c" ? V4C_POOL_ABI : POOL_ABI;
  // The old legacy AMM has no swap()/getAmountOut() at all — both real
  // factory-created pool versions (v2 and v3/v4) do, just with a different
  // arg count on swap() itself (handled separately in doSwap below).
  const swapSupported = pool.abiVersion !== "legacy";
  const stableA = STABLE_SYMBOLS.has(resolvedSymbolA);
  const stableB = STABLE_SYMBOLS.has(resolvedSymbolB);
  const isStablePair = stableA && stableB;

  useEffect(() => {
    let cancelled = false;
    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    if (pool.symbolA.startsWith("0x")) {
      resolveTokenSymbol(pool.addressA, client).then(s => { if (!cancelled) { setResolvedSymbolA(s); onSymbolResolved(pool.poolAddress, "a", s); } });
    }
    if (pool.symbolB.startsWith("0x")) {
      resolveTokenSymbol(pool.addressB, client).then(s => { if (!cancelled) { setResolvedSymbolB(s); onSymbolResolved(pool.poolAddress, "b", s); } });
    }
    // Decimals are verified on-chain for every token, known or not — a wrong hardcoded
    // guess (e.g. assuming cirBTC is 6 decimals like the other Circle assets) silently
    // breaks amounts, so nothing gets to skip this check.
    resolveTokenDecimals(pool.addressA, client).then(d => { if (!cancelled) setDecimalsA(d); });
    resolveTokenDecimals(pool.addressB, client).then(d => { if (!cancelled) setDecimalsB(d); });
    return () => { cancelled = true; };
  }, [pool.addressA, pool.addressB, pool.symbolA, pool.symbolB, pool.poolAddress, onSymbolResolved]);

  const loadData = useCallback(async () => {
    setLoading(true);
    let tvl: number | null = null;
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [resA, resB] = await client.readContract({ address: pool.poolAddress, abi, functionName: "getReserves" });
      const rA = Number(formatUnits(resA, decimalsA));
      const rB = Number(formatUnits(resB, decimalsB));
      setReserves({ a: rA.toFixed(reservePrecision(decimalsA)), b: rB.toFixed(reservePrecision(decimalsB)) });
      tvl = stableA && stableB ? rA + rB : stableA ? rA * 2 : stableB ? rB * 2 : null;

      // User-specific position data needs a real connected address — keep
      // this failure separate from the pool-level data above, so a missing
      // wallet (or an RPC hiccup on just this call) doesn't stop TVL/volume
      // from ever being reported for the whole page.
      try {
        if (address) {
          const [myA, myB] = await client.readContract({ address: pool.poolAddress, abi, functionName: "getShareValue", args: [address as `0x${string}`] });
          const myShares = await client.readContract({ address: pool.poolAddress, abi, functionName: "shares", args: [address as `0x${string}`] });
          const total = await client.readContract({ address: pool.poolAddress, abi, functionName: "totalShares" });
          const pct = total > 0n ? (Number(myShares) / Number(total)) * 100 : 0;
          setMyShare({ a: Number(formatUnits(myA, decimalsA)).toFixed(reservePrecision(decimalsA)), b: Number(formatUnits(myB, decimalsB)).toFixed(reservePrecision(decimalsB)), pct: pct.toFixed(3) });
        } else {
          setMyShare(null);
        }
      } catch {
        setMyShare(null);
      }

      let swapCount = 0;
      let volume7d: number | null = null;
      let shape: number[] = [];
      let logsUnavailable = false;
      try {
        const currentBlock = await client.getBlockNumber();
        const { logs, ok } = await fetchSwapLogsWithFallback(client, pool.poolAddress, currentBlock);
        if (!ok) throw new Error("log fetch failed at every window size");
        swapCount = logs.length;
        shape = logs.slice(-12).map(log => Number(formatUnits(log.args.amountIn ?? 0n, log.args.aToB ? decimalsA : decimalsB)));
        if (stableA || stableB) {
          // Only the swaps where the *input* token is the known stablecoin can be priced directly.
          volume7d = logs.reduce((sum, log) => {
            const inputIsStable = log.args.aToB ? stableA : stableB;
            if (!inputIsStable) return sum;
            const inDecimals = log.args.aToB ? decimalsA : decimalsB;
            return sum + Number(formatUnits(log.args.amountIn ?? 0n, inDecimals));
          }, 0);
        }
      } catch {
        // Most public RPCs cap eth_getLogs to a limited block range — surface this
        // explicitly rather than silently reporting "0 swaps" (which looks like no activity).
        logsUnavailable = true;
      }

      const fees7d = volume7d !== null ? volume7d * 0.003 : null;
      const apr = fees7d !== null && tvl && tvl > 0 ? (fees7d / tvl) * (365 / 7) * 100 : null;

      const next: PoolMetrics = { tvl, swapCount7d: swapCount, volume7d, fees7d, apr, shape, logsUnavailable };
      setMetrics(next);
      onMetrics(pool.poolAddress, next);
    } catch {
      setReserves(null);
      setMyShare(null);
      // Even a total failure (e.g. bad reserves read) must still report
      // something — otherwise this pool's slot in poolMetrics never fills
      // in, and the page-wide TVL/Volume cards stay stuck on "..." forever.
      const next: PoolMetrics = { tvl: null, swapCount7d: 0, volume7d: null, fees7d: null, apr: null, shape: [], logsUnavailable: true };
      setMetrics(next);
      onMetrics(pool.poolAddress, next);
    } finally {
      setLoading(false);
    }
  }, [pool.poolAddress, address, abi, resolvedSymbolA, resolvedSymbolB, decimalsA, decimalsB, onMetrics, refreshNonce]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasPosition = myShare && Number(myShare.pct) > 0;
  const swapTokenIn = swapDirAtoB ? tokenAInfo : tokenBInfo;
  const swapTokenOut = swapDirAtoB ? tokenBInfo : tokenAInfo;

  useEffect(() => {
    async function estimate() {
      if (!swapSupported || !swapAmountIn || isNaN(Number(swapAmountIn)) || Number(swapAmountIn) <= 0) {
        setSwapEstOut("0.00");
        return;
      }
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const amountIn = parseUnits(swapAmountIn, swapDirAtoB ? decimalsA : decimalsB);
        const out = await client.readContract({ address: pool.poolAddress, abi, functionName: "getAmountOut", args: [swapDirAtoB, amountIn] });
        setSwapEstOut(Number(formatUnits(out as bigint, swapDirAtoB ? decimalsB : decimalsA)).toFixed(reservePrecision(swapDirAtoB ? decimalsB : decimalsA)));
      } catch {
        setSwapEstOut("0.00");
      }
    }
    estimate();
  }, [swapAmountIn, swapDirAtoB, pool.poolAddress, swapSupported, decimalsA, decimalsB, abi]);

  async function doSwap() {
    if (!swapTokenIn || !swapAmountIn || Number(swapAmountIn) <= 0) { setSwapError("Enter a valid amount."); return; }
    setSwapError(null); setSwapTxHash(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const amountIn = parseUnits(swapAmountIn, swapDirAtoB ? decimalsA : decimalsB);

      setSwapState("approving");
      const approveHash = await wc.writeContract({
        address: swapTokenIn.address, abi: erc20Abi, functionName: "approve",
        args: [pool.poolAddress, amountIn], account: address as `0x${string}`,
      });
      await waitForSuccess(publicClient, approveHash);

      setSwapState("swapping");
      // v2 pools' swap() has no deadline param (3 args); v3/v4/v4b/v4c all use
      // the 4-arg version (deadline) — v4c only changed addLiquidity's
      // signature, not swap's.
      const swapArgs = (pool.abiVersion === "v3v4" || pool.abiVersion === "v4c")
        ? [swapDirAtoB, amountIn, 0n, BigInt(Math.floor(Date.now() / 1000) + 3600)] as const
        : [swapDirAtoB, amountIn, 0n] as const;
      const hash = await wc.writeContract({
        address: pool.poolAddress, abi, functionName: "swap",
        args: swapArgs, account: address as `0x${string}`,
      });
      await waitForSuccess(publicClient, hash);

      setSwapTxHash(hash); setSwapState("done"); setSwapAmountIn(""); setSwapEstOut("0.00");
      await loadData();
      onRefresh();
      showToast("Swap complete", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSwapError(err.message ?? "Swap failed."); setSwapState("error");
    }
  }

  async function doAdd() {
    if (!amountA || !amountB || Number(amountA) <= 0 || Number(amountB) <= 0) {
      setErrorMsg("Enter valid amounts for both tokens."); return;
    }
    if (!tokenAInfo || !tokenBInfo) return;
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const unitsA = parseUnits(amountA, decimalsA);
      const unitsB = parseUnits(amountB, decimalsB);

      setState("approving1");
      const a1 = await wc.writeContract({ address: tokenAInfo.address, abi: erc20Abi, functionName: "approve", args: [pool.poolAddress, unitsA], account: address as `0x${string}` });
      await waitForSuccess(publicClient, a1);

      setState("approving2");
      const a2 = await wc.writeContract({ address: tokenBInfo.address, abi: erc20Abi, functionName: "approve", args: [pool.poolAddress, unitsB], account: address as `0x${string}` });
      await waitForSuccess(publicClient, a2);

      setState("processing");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      // 1% slippage tolerance — protects against the pool's ratio moving
      // between submitting and mining without being so tight that a normal
      // block or two of drift causes a spurious revert.
      const minA = (unitsA * 99n) / 100n;
      const minB = (unitsB * 99n) / 100n;
      const addArgs =
        pool.abiVersion === "v4c" ? [unitsA, unitsB, minA, minB, deadline] as const :
        pool.abiVersion === "v3v4" ? [unitsA, unitsB, deadline] as const :
        [unitsA, unitsB] as const;
      const hash = await wc.writeContract({ address: pool.poolAddress, abi, functionName: "addLiquidity", args: addArgs, account: address as `0x${string}` });
      await waitForSuccess(publicClient, hash);

      setState("idle"); setAmountA(""); setAmountB("");
      await loadData();
      onRefresh();
      showToast("Liquidity added", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to add liquidity."); setState("error");
    }
  }

  async function doRemove() {
    if (!myShare) return;
    setErrorMsg(null); setState("processing");
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const myShares = await client.readContract({ address: pool.poolAddress, abi, functionName: "shares", args: [address as `0x${string}`] });
      const shareToRemove = (myShares * BigInt(removePct)) / 100n;
      if (shareToRemove === 0n) throw new Error("Nothing to remove.");

      const removeArgs = (pool.abiVersion === "v3v4" || pool.abiVersion === "v4c") ? [shareToRemove, BigInt(Math.floor(Date.now() / 1000) + 3600)] as const : [shareToRemove] as const;
      const hash = await wc.writeContract({ address: pool.poolAddress, abi, functionName: "removeLiquidity", args: removeArgs, account: address as `0x${string}` });
      await waitForSuccess(publicClient, hash);

      setState("idle");
      await loadData();
      onRefresh();
      showToast("Liquidity removed", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to remove liquidity."); setState("error");
    }
  }

  const isLoading = state === "approving1" || state === "approving2" || state === "processing";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {!isMobile ? (
        <div
          onClick={onToggle}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#FAF8FF"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 80px 72px", gap: 10, alignItems: "center", padding: "0 20px", minHeight: 64, transition: "background 0.1s ease", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex" }}>
              <div style={{ borderRadius: "50%", overflow: "hidden" }}><TokenIcon symbol={resolvedSymbolA} size={28} /></div>
              <div style={{ borderRadius: "50%", overflow: "hidden", marginLeft: -10 }}><TokenIcon symbol={resolvedSymbolB} size={28} /></div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{resolvedSymbolA} / {resolvedSymbolB}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#111827", fontWeight: 600 }}>Constant Product</div>
            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 500 }}>0.3% fee</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="flowfi-mono" style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>{!loading && metrics.tvl !== null ? formatCompact(metrics.tvl) : loading ? "..." : "$0.00"}</div>
            {reserves && <div style={{ fontSize: 10, color: "#9CA3AF" }}>{reserves.a} {resolvedSymbolA} · {reserves.b} {resolvedSymbolB}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            {metrics.logsUnavailable ? (
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>—</span>
            ) : metrics.swapCount7d === 0 ? (
              <span style={{ fontSize: 11, color: "#9CA3AF", background: "#F3F4F6", padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>New</span>
            ) : (
              <span style={{ fontSize: 13, color: "#5B21B6", fontWeight: 800 }}>{metrics.apr !== null ? `${metrics.apr.toFixed(2)}%` : "—"}</span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
              style={{ padding: "6px 14px", borderRadius: 999, border: "1px solid #D4C9FA", background: expanded ? "#5B21B6" : "#ffffff", color: expanded ? "#ffffff" : "#6D5EF7", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {expanded ? "Close" : "Add"}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={onToggle}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "transparent", border: "none", padding: "0.85rem 1rem", cursor: "pointer", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${pool.colorA}, ${pool.colorA}AA)`, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #ffffff" }}>{resolvedSymbolA.slice(0, 2)}</div>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${pool.colorB}, ${pool.colorB}AA)`, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #ffffff", marginLeft: -8 }}>{resolvedSymbolB.slice(0, 2)}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{resolvedSymbolA}/{resolvedSymbolB}</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>
                {!loading && metrics.tvl !== null ? formatCompact(metrics.tvl) : "—"} · {metrics.logsUnavailable ? "Activity unavailable" : metrics.swapCount7d === 0 ? "Not traded yet" : metrics.apr !== null ? `${metrics.apr.toFixed(1)}% APR` : "—"}
              </div>
            </div>
          </div>
          <span style={{ color: "#5B21B6", fontSize: 12, fontWeight: 700 }}>{expanded ? "Close" : "Add ▾"}</span>
        </button>
      )}
      <div style={{ height: 2, borderRadius: 2, background: `${pool.colorA}15`, overflow: "hidden" }}>
        <div style={{ height: "100%", width: metrics.apr !== null ? `${Math.min(metrics.apr, 100)}%` : "0%", background: `linear-gradient(90deg, ${pool.colorA}, ${pool.colorB})`, borderRadius: 2, transition: "width 0.3s" }} />
      </div>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: isMobile ? "0 1rem 1rem" : "0 1.25rem 1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 6 }}>
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>TVL</div>
              <div style={{ fontSize: 12, color: "#111827", fontWeight: 700 }}>{loading ? "..." : metrics.tvl !== null ? `$${metrics.tvl.toFixed(2)}` : "—"}</div>
            </div>
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>EST. APR</div>
              <div style={{ fontSize: 12, color: "#16A34A", fontWeight: 700 }}>{loading ? "..." : metrics.apr !== null ? `${metrics.apr.toFixed(1)}%` : "—"}</div>
            </div>
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>VOLUME</div>
              <div style={{ fontSize: 12, color: "#111827", fontWeight: 700 }}>{loading ? "..." : metrics.volume7d !== null ? `$${metrics.volume7d.toFixed(2)}` : `${metrics.swapCount7d} swaps`}</div>
            </div>
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>FEES</div>
              <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700 }}>{loading ? "..." : metrics.fees7d !== null ? `$${metrics.fees7d.toFixed(3)}` : "—"}</div>
            </div>
          </div>
          {metrics.logsUnavailable && (
            <p style={{ fontSize: 10, color: "#D97706", margin: 0 }}>Couldn't load recent swap activity from the RPC — TVL is still accurate, but volume/APR may be understated. Try again shortly.</p>
          )}
          {!metrics.logsUnavailable && !stableA && !stableB && (
            <p style={{ fontSize: 10, color: "#374151", margin: 0 }}>Neither side of this pool is a known stablecoin, so TVL and volume can't be priced in $ — showing raw swap count instead.</p>
          )}
          {!metrics.logsUnavailable && (stableA || stableB) && !isStablePair && (
            <p style={{ fontSize: 10, color: "#374151", margin: 0 }}>Only one side is a known stablecoin — TVL and volume are approximated from that side.</p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.7rem 0.85rem" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 3 }}>{resolvedSymbolA}</div>
              <div style={{ fontSize: 14, color: "#111827", fontWeight: 700 }}>{loading ? "..." : reserves ? reserves.a : "—"}</div>
              {myShare && <div style={{ fontSize: 10, color: "#374151" }}>You: {myShare.a}</div>}
            </div>
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.7rem 0.85rem" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 3 }}>{resolvedSymbolB}</div>
              <div style={{ fontSize: 14, color: "#111827", fontWeight: 700 }}>{loading ? "..." : reserves ? reserves.b : "—"}</div>
              {myShare && <div style={{ fontSize: 10, color: "#374151" }}>You: {myShare.b}</div>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            {swapSupported && (
              <button onClick={() => setMode("swap")}
                style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: mode === "swap" ? "#ede9fe" : "#f5f3ff", color: mode === "swap" ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Swap
              </button>
            )}
            <button onClick={() => setMode("add")}
              style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: mode === "add" ? "#ede9fe" : "#f5f3ff", color: mode === "add" ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Add
            </button>
            <button onClick={() => setMode("remove")}
              style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: mode === "remove" ? "#ede9fe" : "#f5f3ff", color: mode === "remove" ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Remove
            </button>
          </div>

          {mode === "swap" && swapSupported && (
            <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ background: "#ffffff", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
                  <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>You pay</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <input type="number" min="0" placeholder="0.00" value={swapAmountIn} onChange={(e) => setSwapAmountIn(e.target.value)} disabled={swapState === "approving" || swapState === "swapping"}
                      style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 18, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{swapTokenIn.symbol}</span>
                  </div>
                </div>
                <button onClick={() => setSwapDirAtoB(v => !v)} disabled={swapState === "approving" || swapState === "swapping"}
                  style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 28, height: 28, borderRadius: 8, background: "#ffffff", border: "1px solid #EDE9FE", color: "#6D5EF7", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                  ↓
                </button>
                <div style={{ background: "#ffffff", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
                  <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>You receive (estimated)</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 18, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{swapEstOut}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{swapTokenOut.symbol}</span>
                  </div>
                </div>
              </div>
              {swapPriceStale && (
                <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "0.6rem 0.8rem" }}>
                  <p style={{ fontSize: 11, color: "#B45309", margin: 0 }}>
                    This pool's price is {swapPriceDeviationPct?.toFixed(1)}% off the live market rate. Thin liquidity means nothing is correcting it automatically — double-check before swapping a large amount.
                  </p>
                </div>
              )}
              {swapError && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#DC2626", fontSize: 12 }}>{swapError}</div>}
              {swapTxHash && swapState === "done" && (
                <a href={`https://testnet.arcscan.app/tx/${swapTxHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#6D5EF7", textAlign: "center" }}>View on explorer ↗</a>
              )}
              <button onClick={doSwap} disabled={swapState === "approving" || swapState === "swapping"}
                style={{ width: "100%", padding: "0.7rem", borderRadius: 10, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: swapState === "approving" || swapState === "swapping" ? "not-allowed" : "pointer", opacity: swapState === "approving" || swapState === "swapping" ? 0.6 : 1 }}>
                {swapState === "approving" ? "Approving..." : swapState === "swapping" ? "Swapping..." : "Swap"}
              </button>
            </div>
          )}

          {mode === "add" && (
            <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <input type="number" min="0" placeholder={`${resolvedSymbolA} amount`} value={amountA} onChange={(e) => setAmountA(e.target.value)} disabled={isLoading}
                style={{ background: "#f5f3ff", border: "none", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none" }} />
              <input type="number" min="0" placeholder={`${resolvedSymbolB} amount`} value={amountB} onChange={(e) => setAmountB(e.target.value)} disabled={isLoading}
                style={{ background: "#f5f3ff", border: "none", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none" }} />
              {errorMsg && <div style={{ fontSize: 11, color: "#DC2626" }}>{errorMsg}</div>}
              <button onClick={doAdd} disabled={isLoading}
                style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #7c3aed, #7c3aed)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "approving1" && "Approving..."}
                {state === "approving2" && "Approving..."}
                {state === "processing" && "Adding..."}
                {(state === "idle" || state === "error") && "Add Liquidity"}
              </button>
            </div>
          )}

          {mode === "remove" && (
            <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              {hasPosition ? (
                <>
                  <input type="range" min="1" max="100" value={removePct} onChange={(e) => setRemovePct(Number(e.target.value))} disabled={isLoading} />
                  <div style={{ fontSize: 11, color: "#4B5563" }}>{removePct}% — {(Number(myShare!.a) * removePct / 100).toFixed(reservePrecision(decimalsA))} {resolvedSymbolA} + {(Number(myShare!.b) * removePct / 100).toFixed(reservePrecision(decimalsB))} {resolvedSymbolB}</div>
                  {errorMsg && <div style={{ fontSize: 11, color: "#DC2626" }}>{errorMsg}</div>}
                  <button onClick={doRemove} disabled={isLoading}
                    style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #dc2626, #ef4444)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                    {state === "processing" ? "Removing..." : "Remove"}
                  </button>
                </>
              ) : (
                <p style={{ fontSize: 12, color: "#4B5563", margin: 0, textAlign: "center" }}>No position in this pool.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

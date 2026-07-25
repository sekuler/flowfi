import { useState, useEffect, useCallback, useRef } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits, parseAbiItem } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";

const FACTORY_CONTRACT = "0xE610D2f76547c2a3073e1273E7BFA80d395eCDf8" as `0x${string}`;
const LEGACY_AMM_CONTRACT = "0x01ddb4902e2F22f6124Ec685540C424d1BB75E0C" as `0x${string}`;
const TOKEN_LAUNCH_FACTORY = "0x481E8919f79A4DA6446EA78cEa70037acB9c85A1" as `0x${string}`;
const STABLE_SYMBOLS = new Set(["USDC", "EURC", "USYC"]);

const TOKEN_LAUNCH_FACTORY_ABI = [
  { type: "function", name: "allTokensLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allTokens", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

const TOKEN_NAME_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

const KNOWN_TOKENS: { symbol: string; address: `0x${string}`; color: string }[] = [
  { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", color: "#2563eb" },
  { symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", color: "#7c3aed" },
  { symbol: "USYC", address: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C", color: "#f59e0b" },
  { symbol: "ARCC", address: "0x215D82093892AA24b2901aeb4fcCca933346De18", color: "#10b981" },
  { symbol: "cirBTC", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", color: "#f97316" },
];

const FACTORY_ABI = [
  { type: "function", name: "createPool", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "pool", type: "address" }] },
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "allPoolsLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allPools", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_ABI = [
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
  isLegacy: boolean;
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

async function tokenMeta(addr: string, client: ReturnType<typeof createPublicClient>) {
  const known = KNOWN_TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase());
  if (known) return known;
  try {
    const symbol = await client.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: "symbol" });
    return { symbol, address: addr as `0x${string}`, color: "#64748b" };
  } catch {
    return { symbol: addr.slice(0, 6), address: addr as `0x${string}`, color: "#64748b" };
  }
}

export default function LiquidityPools({ provider, address, onRefresh }: Props) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tokenASym, setTokenASym] = useState("USDC");
  const [tokenBSym, setTokenBSym] = useState("EURC");
  const [customAAddr, setCustomAAddr] = useState("");
  const [customBAddr, setCustomBAddr] = useState("");
  const [searchAResults, setSearchAResults] = useState<{ symbol: string; name: string; address: string }[]>([]);
  const [searchBResults, setSearchBResults] = useState<{ symbol: string; name: string; address: string }[]>([]);
  const [searchingA, setSearchingA] = useState(false);
  const [searchingB, setSearchingB] = useState(false);
  const [launchedTokenCache, setLaunchedTokenCache] = useState<{ symbol: string; name: string; address: string }[] | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const debounceARef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceBRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function ensureTokenCache(): Promise<{ symbol: string; name: string; address: string }[]> {
    if (launchedTokenCache && launchedTokenCache.length > 0) return launchedTokenCache;
    if (cacheLoading) {
      let waited = 0;
      while (cacheLoading && waited < 15000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
      return launchedTokenCache ?? [];
    }
    setCacheLoading(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const count = await client.readContract({ address: TOKEN_LAUNCH_FACTORY, abi: TOKEN_LAUNCH_FACTORY_ABI, functionName: "allTokensLength" });
      const total = Number(count);
      const scanCount = Math.min(total, 20);
      const indices = Array.from({ length: scanCount }, (_, k) => total - 1 - k);

      const list: { symbol: string; name: string; address: string }[] = [];
      const BATCH_SIZE = 4;
      for (let b = 0; b < indices.length; b += BATCH_SIZE) {
        const batch = indices.slice(b, b + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (i) => {
          try {
            const tokenAddr = await client.readContract({ address: TOKEN_LAUNCH_FACTORY, abi: TOKEN_LAUNCH_FACTORY_ABI, functionName: "allTokens", args: [BigInt(i)] });
            const tName = await client.readContract({ address: tokenAddr, abi: TOKEN_NAME_ABI, functionName: "name" });
            const tSymbol = await client.readContract({ address: tokenAddr, abi: TOKEN_NAME_ABI, functionName: "symbol" });
            return { symbol: tSymbol, name: tName, address: tokenAddr as string };
          } catch {
            return null;
          }
        }));
        for (const r of batchResults) if (r) list.push(r);
        if (b + BATCH_SIZE < indices.length) await new Promise(r => setTimeout(r, 250));
      }

      if (list.length > 0) setLaunchedTokenCache(list);
      return list;
    } finally {
      setCacheLoading(false);
    }
  }

  async function searchLaunchedTokens(query: string): Promise<{ symbol: string; name: string; address: string }[]> {
    if (query.trim().startsWith("0x")) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const list = await ensureTokenCache();
    return list
      .filter(r => r.name.toLowerCase().includes(needle) || r.symbol.toLowerCase().includes(needle))
      .slice(0, 8);
  }

  function handleCustomASearch(value: string) {
    setCustomAAddr(value);
    if (debounceARef.current) clearTimeout(debounceARef.current);
    if (value.trim().startsWith("0x") || value.trim().length < 2) { setSearchAResults([]); setSearchingA(false); return; }
    setSearchingA(true);
    debounceARef.current = setTimeout(async () => {
      try {
        const results = await searchLaunchedTokens(value);
        setSearchAResults(results);
      } finally {
        setSearchingA(false);
      }
    }, 400);
  }

  function handleCustomBSearch(value: string) {
    setCustomBAddr(value);
    if (debounceBRef.current) clearTimeout(debounceBRef.current);
    if (value.trim().startsWith("0x") || value.trim().length < 2) { setSearchBResults([]); setSearchingB(false); return; }
    setSearchingB(true);
    debounceBRef.current = setTimeout(async () => {
      try {
        const results = await searchLaunchedTokens(value);
        setSearchBResults(results);
      } finally {
        setSearchingB(false);
      }
    }, 400);
  }
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    setLoadingPools(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const count = await client.readContract({ address: FACTORY_CONTRACT, abi: FACTORY_ABI, functionName: "allPoolsLength" });
      const loaded: PoolInfo[] = [];

      loaded.push({
        poolAddress: LEGACY_AMM_CONTRACT,
        addressA: KNOWN_TOKENS[0].address, addressB: KNOWN_TOKENS[1].address,
        symbolA: "USDC", symbolB: "EURC",
        colorA: "#2563eb", colorB: "#7c3aed",
        isLegacy: true,
      });

      for (let i = 0; i < Number(count); i++) {
        const poolAddr = await client.readContract({ address: FACTORY_CONTRACT, abi: FACTORY_ABI, functionName: "allPools", args: [BigInt(i)] });
        const tA = await client.readContract({ address: poolAddr, abi: POOL_ABI, functionName: "tokenA" });
        const tB = await client.readContract({ address: poolAddr, abi: POOL_ABI, functionName: "tokenB" });
        const metaA = await tokenMeta(tA, client);
        const metaB = await tokenMeta(tB, client);
        loaded.push({
          poolAddress: poolAddr, addressA: tA, addressB: tB,
          symbolA: metaA.symbol, symbolB: metaB.symbol,
          colorA: metaA.color, colorB: metaB.color, isLegacy: false,
        });
        await new Promise(r => setTimeout(r, 50));
      }
      setPools(loaded);
    } catch {
      setPools([{ poolAddress: LEGACY_AMM_CONTRACT, addressA: KNOWN_TOKENS[0].address, addressB: KNOWN_TOKENS[1].address, symbolA: "USDC", symbolB: "EURC", colorA: "#2563eb", colorB: "#7c3aed", isLegacy: true }]);
    } finally {
      setLoadingPools(false);
    }
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);

  async function createPool() {
    const tokenA = tokenASym === "CUSTOM" ? customAAddr.trim() : KNOWN_TOKENS.find(t => t.symbol === tokenASym)?.address;
    const tokenB = tokenBSym === "CUSTOM" ? customBAddr.trim() : KNOWN_TOKENS.find(t => t.symbol === tokenBSym)?.address;
    if (!tokenA || !tokenB) { setCreateError("Enter a valid token address."); return; }
    if (tokenA.toLowerCase() === tokenB.toLowerCase()) { setCreateError("Choose two different tokens."); return; }
    setCreateError(null); setCreating(true);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      const existing = await publicClient.readContract({ address: FACTORY_CONTRACT, abi: FACTORY_ABI, functionName: "getPool", args: [tokenA as `0x${string}`, tokenB as `0x${string}`] });
      if (existing !== "0x0000000000000000000000000000000000000000") {
        throw new Error("Pool already exists for this pair.");
      }

      const hash = await wc.writeContract({ address: FACTORY_CONTRACT, abi: FACTORY_ABI, functionName: "createPool", args: [tokenA as `0x${string}`, tokenB as `0x${string}`], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setShowCreate(false);
      await loadPools();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setCreateError(err.message ?? "Failed to create pool.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 460 }}>
      <div style={{ background: "rgba(79,70,229,0.05)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#a5b4fc", margin: 0 }}>
          Permissionless AMM factory — anyone can create a pool for any token pair, add liquidity, and swap.
        </p>
      </div>

      <button onClick={() => setShowCreate(!showCreate)}
        style={{ width: "100%", padding: "0.8rem", borderRadius: 12, border: "1px dashed rgba(79,70,229,0.4)", background: "rgba(79,70,229,0.06)", color: "#a5b4fc", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
        {showCreate ? "Cancel" : "+ Create New Pool"}
      </button>

      {showCreate && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={tokenASym} onChange={(e) => setTokenASym(e.target.value)}
              style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.65rem", color: "#f1f5f9", fontSize: 13 }}>
              {KNOWN_TOKENS.map(t => <option key={t.symbol} value={t.symbol} style={{ color: "#000" }}>{t.symbol}</option>)}
              <option value="CUSTOM" style={{ color: "#000" }}>Custom token...</option>
            </select>
            <span style={{ color: "#475569" }}>+</span>
            <select value={tokenBSym} onChange={(e) => setTokenBSym(e.target.value)}
              style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.65rem", color: "#f1f5f9", fontSize: 13 }}>
              {KNOWN_TOKENS.map(t => <option key={t.symbol} value={t.symbol} style={{ color: "#000" }}>{t.symbol}</option>)}
              <option value="CUSTOM" style={{ color: "#000" }}>Custom token...</option>
            </select>
          </div>
          {tokenASym === "CUSTOM" && (
            <div style={{ position: "relative" }}>
              <input type="text" placeholder="Token name (e.g. Doge) or address (0x...)" value={customAAddr} onChange={(e) => handleCustomASearch(e.target.value)}
                style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.65rem 0.8rem", color: "#f1f5f9", fontSize: 12, outline: "none" }} />
              {searchingA && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Searching...</div>}
              {searchAResults.length > 0 && (
                <div style={{ marginTop: 6, background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
                  {searchAResults.map((r) => (
                    <button key={r.address} onClick={() => { setCustomAAddr(r.address); setSearchAResults([]); }}
                      style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "0.6rem 0.8rem", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{r.name} <span style={{ color: "#64748b", fontWeight: 400 }}>{r.symbol}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {tokenBSym === "CUSTOM" && (
            <div style={{ position: "relative" }}>
              <input type="text" placeholder="Token name (e.g. Doge) or address (0x...)" value={customBAddr} onChange={(e) => handleCustomBSearch(e.target.value)}
                style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.65rem 0.8rem", color: "#f1f5f9", fontSize: 12, outline: "none" }} />
              {searchingB && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Searching...</div>}
              {searchBResults.length > 0 && (
                <div style={{ marginTop: 6, background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
                  {searchBResults.map((r) => (
                    <button key={r.address} onClick={() => { setCustomBAddr(r.address); setSearchBResults([]); }}
                      style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "0.6rem 0.8rem", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{r.name} <span style={{ color: "#64748b", fontWeight: 400 }}>{r.symbol}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {createError && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#fca5a5", fontSize: 12 }}>{createError}</div>}
          <button onClick={createPool} disabled={creating}
            style={{ width: "100%", padding: "0.8rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: creating ? "not-allowed" : "pointer", opacity: creating ? 0.6 : 1 }}>
            {creating ? "Creating Pool..." : "Create Pool"}
          </button>
          <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>Pool starts empty. You'll add the first liquidity next.</p>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 700, letterSpacing: "1px" }}>ALL POOLS</div>

      {loadingPools && <div style={{ fontSize: 12, color: "#334155" }}>Loading pools...</div>}

      {!loadingPools && pools.map((pool) => (
        <PoolRow key={pool.poolAddress} pool={pool} provider={provider} address={address}
          expanded={expandedPool === pool.poolAddress}
          onToggle={() => setExpandedPool(expandedPool === pool.poolAddress ? null : pool.poolAddress)}
          onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function PoolRow({ pool, provider, address, expanded, onToggle, onRefresh }: {
  pool: PoolInfo; provider: EIP1193Provider; address: string;
  expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"swap" | "add" | "remove">("swap");
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [removePct, setRemovePct] = useState(50);
  const [state, setState] = useState<"idle" | "approving1" | "approving2" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reserves, setReserves] = useState<{ a: string; b: string } | null>(null);
  const [myShare, setMyShare] = useState<{ a: string; b: string; pct: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<{ tvl: number | null; swapCount7d: number; volume7d: number | null; fees7d: number | null; apr: number | null }>({ tvl: null, swapCount7d: 0, volume7d: null, fees7d: null, apr: null });

  const [swapDirAtoB, setSwapDirAtoB] = useState(true);
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapEstOut, setSwapEstOut] = useState("0.00");
  const [swapState, setSwapState] = useState<"idle" | "approving" | "swapping" | "done" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);

  const tokenAInfo = { symbol: pool.symbolA, address: pool.addressA, color: pool.colorA };
  const tokenBInfo = { symbol: pool.symbolB, address: pool.addressB, color: pool.colorB };
  const abi = pool.isLegacy ? LEGACY_ABI : POOL_ABI;
  const isStablePair = STABLE_SYMBOLS.has(pool.symbolA) && STABLE_SYMBOLS.has(pool.symbolB);
  const swapSupported = !pool.isLegacy;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [resA, resB] = await client.readContract({ address: pool.poolAddress, abi, functionName: "getReserves" });
      const rA = Number(formatUnits(resA, 6));
      const rB = Number(formatUnits(resB, 6));
      setReserves({ a: rA.toFixed(4), b: rB.toFixed(4) });

      const [myA, myB] = await client.readContract({ address: pool.poolAddress, abi, functionName: "getShareValue", args: [address as `0x${string}`] });
      const myShares = await client.readContract({ address: pool.poolAddress, abi, functionName: "shares", args: [address as `0x${string}`] });
      const total = await client.readContract({ address: pool.poolAddress, abi, functionName: "totalShares" });
      const pct = total > 0n ? (Number(myShares) / Number(total)) * 100 : 0;
      setMyShare({ a: Number(formatUnits(myA, 6)).toFixed(4), b: Number(formatUnits(myB, 6)).toFixed(4), pct: pct.toFixed(3) });

      const tvl = isStablePair ? rA + rB : null;

      let swapCount = 0;
      let volume7d: number | null = null;
      try {
        const currentBlock = await client.getBlockNumber();
        const fromBlock = currentBlock > 100000n ? currentBlock - 100000n : 0n;
        const logs = await client.getLogs({ address: pool.poolAddress, event: SWAP_EVENT, fromBlock, toBlock: "latest" });
        swapCount = logs.length;
        if (isStablePair) {
          volume7d = logs.reduce((sum, log) => sum + Number(formatUnits(log.args.amountIn ?? 0n, 6)), 0);
        }
      } catch {
        /* leave swapCount at 0 if log fetch fails */
      }

      const fees7d = volume7d !== null ? volume7d * 0.003 : null;
      const apr = fees7d !== null && tvl && tvl > 0 ? (fees7d / tvl) * (365 / 7) * 100 : null;

      setMetrics({ tvl, swapCount7d: swapCount, volume7d, fees7d, apr });
    } catch {
      setReserves(null);
      setMyShare(null);
    } finally {
      setLoading(false);
    }
  }, [pool.poolAddress, address, abi, isStablePair]);

  useEffect(() => { if (expanded) loadData(); }, [expanded, loadData]);

  useEffect(() => {
    async function estimate() {
      if (!swapSupported || !swapAmountIn || isNaN(Number(swapAmountIn)) || Number(swapAmountIn) <= 0) {
        setSwapEstOut("0.00");
        return;
      }
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const amountIn = parseUnits(swapAmountIn, 6);
        const out = await client.readContract({ address: pool.poolAddress, abi: POOL_ABI, functionName: "getAmountOut", args: [swapDirAtoB, amountIn] });
        setSwapEstOut(Number(formatUnits(out as bigint, 6)).toFixed(4));
      } catch {
        setSwapEstOut("0.00");
      }
    }
    estimate();
  }, [swapAmountIn, swapDirAtoB, pool.poolAddress, swapSupported]);

  const hasPosition = myShare && Number(myShare.pct) > 0;
  const swapTokenIn = swapDirAtoB ? tokenAInfo : tokenBInfo;
  const swapTokenOut = swapDirAtoB ? tokenBInfo : tokenAInfo;

  async function doSwap() {
    if (!swapTokenIn || !swapAmountIn || Number(swapAmountIn) <= 0) { setSwapError("Enter a valid amount."); return; }
    setSwapError(null); setSwapTxHash(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const amountIn = parseUnits(swapAmountIn, 6);

      setSwapState("approving");
      const approveHash = await wc.writeContract({
        address: swapTokenIn.address, abi: erc20Abi, functionName: "approve",
        args: [pool.poolAddress, amountIn], account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setSwapState("swapping");
      const hash = await wc.writeContract({
        address: pool.poolAddress, abi: POOL_ABI, functionName: "swap",
        args: [swapDirAtoB, amountIn, 0n], account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setSwapTxHash(hash); setSwapState("done"); setSwapAmountIn(""); setSwapEstOut("0.00");
      await loadData();
      onRefresh();
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
      const unitsA = parseUnits(amountA, 6);
      const unitsB = parseUnits(amountB, 6);

      setState("approving1");
      const a1 = await wc.writeContract({ address: tokenAInfo.address, abi: erc20Abi, functionName: "approve", args: [pool.poolAddress, unitsA], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      setState("approving2");
      const a2 = await wc.writeContract({ address: tokenBInfo.address, abi: erc20Abi, functionName: "approve", args: [pool.poolAddress, unitsB], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a2 });

      setState("processing");
      const hash = await wc.writeContract({ address: pool.poolAddress, abi, functionName: "addLiquidity", args: [unitsA, unitsB], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setAmountA(""); setAmountB("");
      await loadData();
      onRefresh();
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

      const hash = await wc.writeContract({ address: pool.poolAddress, abi, functionName: "removeLiquidity", args: [shareToRemove], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle");
      await loadData();
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to remove liquidity."); setState("error");
    }
  }

  const isLoading = state === "approving1" || state === "approving2" || state === "processing";
  const isSwapLoading = swapState === "approving" || swapState === "swapping";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button onClick={onToggle}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "1rem 1.25rem", cursor: "pointer", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: pool.colorA, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #0a1a2f" }}>{pool.symbolA.slice(0, 2)}</div>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: pool.colorB, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #0a1a2f", marginLeft: -8 }}>{pool.symbolB.slice(0, 2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{pool.symbolA}-{pool.symbolB}</div>
            <div style={{ fontSize: 10, color: "#475569" }}>0.3% fee</div>
          </div>
        </div>
        <span style={{ color: "#64748b", fontSize: 13, transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", paddingLeft: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>TVL</div>
              <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{loading ? "..." : metrics.tvl !== null ? `$${metrics.tvl.toFixed(2)}` : "—"}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>EST. APR</div>
              <div style={{ fontSize: 12, color: "#6ee7b7", fontWeight: 700 }}>{loading ? "..." : metrics.apr !== null ? `${metrics.apr.toFixed(1)}%` : "—"}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>VOLUME</div>
              <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{loading ? "..." : metrics.volume7d !== null ? `$${metrics.volume7d.toFixed(2)}` : `${metrics.swapCount7d} swaps`}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.6rem 0.5rem", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#334155", fontWeight: 700, marginBottom: 3 }}>FEES</div>
              <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700 }}>{loading ? "..." : metrics.fees7d !== null ? `$${metrics.fees7d.toFixed(3)}` : "—"}</div>
            </div>
          </div>
          {!isStablePair && (
            <p style={{ fontSize: 10, color: "#475569", margin: 0 }}>TVL, volume ($), and APR require a stablecoin pair to price accurately — showing raw swap count instead.</p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.7rem 0.85rem" }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{pool.symbolA}</div>
              <div style={{ fontSize: 14, color: "#f1f5f9", fontWeight: 700 }}>{loading ? "..." : reserves ? reserves.a : "—"}</div>
              {myShare && <div style={{ fontSize: 10, color: "#475569" }}>You: {myShare.a}</div>}
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.7rem 0.85rem" }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{pool.symbolB}</div>
              <div style={{ fontSize: 14, color: "#f1f5f9", fontWeight: 700 }}>{loading ? "..." : reserves ? reserves.b : "—"}</div>
              {myShare && <div style={{ fontSize: 10, color: "#475569" }}>You: {myShare.b}</div>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            {swapSupported && (
              <button onClick={() => setMode("swap")}
                style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: mode === "swap" ? "2px solid #22d3ee" : "1px solid rgba(255,255,255,0.08)", background: mode === "swap" ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.03)", color: mode === "swap" ? "#67e8f9" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Swap
              </button>
            )}
            <button onClick={() => setMode("add")}
              style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: mode === "add" ? "2px solid #4f46e5" : "1px solid rgba(255,255,255,0.08)", background: mode === "add" ? "rgba(79,70,229,0.15)" : "rgba(255,255,255,0.03)", color: mode === "add" ? "#a5b4fc" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Add
            </button>
            <button onClick={() => setMode("remove")}
              style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: mode === "remove" ? "2px solid #4f46e5" : "1px solid rgba(255,255,255,0.08)", background: mode === "remove" ? "rgba(79,70,229,0.15)" : "rgba(255,255,255,0.03)", color: mode === "remove" ? "#a5b4fc" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Remove
            </button>
          </div>

          {mode === "swap" && swapSupported && (
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 10, color: "#64748b" }}>You pay</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="number" min="0" placeholder="0.00" value={swapAmountIn} onChange={(e) => setSwapAmountIn(e.target.value)} disabled={isSwapLoading}
                  style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 14, color: "#f1f5f9", outline: "none" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", minWidth: 50, textAlign: "center" }}>{swapTokenIn?.symbol}</span>
              </div>
              <button onClick={() => setSwapDirAtoB(!swapDirAtoB)} disabled={isSwapLoading}
                style={{ alignSelf: "center", background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 8, padding: "4px 12px", color: "#67e8f9", fontSize: 14, cursor: "pointer" }}>
                ⇅
              </button>
              <div style={{ fontSize: 10, color: "#64748b" }}>You receive (estimated)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 14, color: "#f1f5f9" }}>{swapEstOut}</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", minWidth: 50, textAlign: "center" }}>{swapTokenOut?.symbol}</span>
              </div>
              {swapError && <div style={{ fontSize: 11, color: "#fca5a5" }}>{swapError}</div>}
              {swapTxHash && swapState === "done" && (
                <a href={`https://testnet.arcscan.app/tx/${swapTxHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#60a5fa" }}>View on explorer</a>
              )}
              <button onClick={doSwap} disabled={isSwapLoading}
                style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #22d3ee, #6366f1)", color: "#04121f", fontSize: 12, fontWeight: 700, cursor: isSwapLoading ? "not-allowed" : "pointer", opacity: isSwapLoading ? 0.6 : 1 }}>
                {swapState === "approving" && "Approving..."}
                {swapState === "swapping" && "Swapping..."}
                {(swapState === "idle" || swapState === "error" || swapState === "done") && "Swap"}
              </button>
            </div>
          )}

          {mode === "add" && (
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <input type="number" min="0" placeholder={`${pool.symbolA} amount`} value={amountA} onChange={(e) => setAmountA(e.target.value)} disabled={isLoading}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#f1f5f9", outline: "none" }} />
              <input type="number" min="0" placeholder={`${pool.symbolB} amount`} value={amountB} onChange={(e) => setAmountB(e.target.value)} disabled={isLoading}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#f1f5f9", outline: "none" }} />
              {errorMsg && <div style={{ fontSize: 11, color: "#fca5a5" }}>{errorMsg}</div>}
              <button onClick={doAdd} disabled={isLoading}
                style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "approving1" && "Approving..."}
                {state === "approving2" && "Approving..."}
                {state === "processing" && "Adding..."}
                {(state === "idle" || state === "error") && "Add Liquidity"}
              </button>
            </div>
          )}

          {mode === "remove" && (
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              {hasPosition ? (
                <>
                  <input type="range" min="1" max="100" value={removePct} onChange={(e) => setRemovePct(Number(e.target.value))} disabled={isLoading} />
                  <div style={{ fontSize: 11, color: "#64748b" }}>{removePct}% — {(Number(myShare!.a) * removePct / 100).toFixed(4)} {pool.symbolA} + {(Number(myShare!.b) * removePct / 100).toFixed(4)} {pool.symbolB}</div>
                  {errorMsg && <div style={{ fontSize: 11, color: "#fca5a5" }}>{errorMsg}</div>}
                  <button onClick={doRemove} disabled={isLoading}
                    style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #dc2626, #ef4444)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                    {state === "processing" ? "Removing..." : "Remove"}
                  </button>
                </>
              ) : (
                <p style={{ fontSize: 12, color: "#64748b", margin: 0, textAlign: "center" }}>No position in this pool.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

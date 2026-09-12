import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, formatUnits, parseUnits } from "viem";
import { waitForSuccess } from "../txHelpers";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { useIsMobile } from "../useIsMobile";
import { showToast } from "../toast";
// ArcTokenFactoryV2 (TOKEN_FACTORY) — atomic launch is NOT possible (createPool
// stays owner-gated on purpose), so this is launch -> (owner creates pool
// separately) -> lockLaunchLiquidity. POOL_FACTORY_V4C is the current
// curated-pool factory, used only to check whether a pool exists yet for a
// launched token.
import { TOKEN_FACTORY, USDC_ADDRESS, POOL_FACTORY_V4C, LAUNCH_POOL_FACTORY } from "../contracts";

const TOKEN_FACTORY_ABI = [
  { type: "function", name: "launchToken", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "supply", type: "uint256" }], outputs: [{ name: "token", type: "address" }] },
  { type: "function", name: "lockLaunchLiquidity", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "pool", type: "address" }, { name: "tokenAmount", type: "uint256" }, { name: "usdcAmount", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [] },
  { type: "function", name: "buyDuringLaunch", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "usdcIn", type: "uint256" }, { name: "minTokenOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "tokenOut", type: "uint256" }] },
  { type: "function", name: "tokenPool", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "launchedAt", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allTokensLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allTokens", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

// ArcLaunchPoolFactory — permissionless pool creation, scoped to tokens
// actually minted through Token Factory. getPool() here takes just the
// token (USDC is implicit), unlike POOL_FACTORY_ABI's two-token version.
const LAUNCH_POOL_FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "createLaunchPool", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "pool", type: "address" }] },
] as const;

// Every pool created by ArcFactoryV2 exposes these — used here just to get
// a live buy quote and figure out which side of the pool is USDC.
const POOL_QUOTE_ABI = [
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "aToB", type: "bool" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

// Anti-snipe window: the contract caps buys during the first 20s after
// launch (see ArcTokenFactoryV2's own comments on Arcscan). This is just
// used to show a countdown badge — the contract enforces the real cap
// regardless of what the UI displays.
const ANTI_SNIPE_WINDOW_SECONDS = 20;

const ERC20_APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const TOKEN_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
}

const AVATAR_COLORS = ["#6D5EF7", "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#8B5CF6"];
function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface LaunchedToken {
  address: string;
  name: string;
  symbol: string;
  supply: string;
  creator: string;
}

// Cosmetic-only metadata (never touches the contract) — see api/token-metadata.js.
interface TokenMetadata {
  description: string;
  xHandle: string;
  telegram: string;
  imageUrl: string;
}

async function fetchTokenMetadata(tokens: string[]): Promise<Record<string, TokenMetadata>> {
  if (tokens.length === 0) return {};
  try {
    const res = await fetch("/api/token-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getMany", tokens }),
    });
    const data = await res.json();
    return data.success ? data.metadata : {};
  } catch {
    return {}; // metadata is purely cosmetic — a failed fetch just means plainer cards, never an error the user sees
  }
}

type FlowStep = "form" | "created";

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

// Inline "Buy" flow for a launched token — resolves its pool, quotes a
// live price, and calls buyDuringLaunch() (approve + buy). This is the
// function's first real caller anywhere in the app; before this it was
// declared in the ABI but never invoked from any screen.
function TokenBuyPanel({ token, provider, address }: { token: { address: string; symbol: string }; provider: EIP1193Provider; address: string }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [poolAddress, setPoolAddress] = useState<`0x${string}` | null | "none">(null);
  const [usdcIsTokenA, setUsdcIsTokenA] = useState(true);
  const [launchedAt, setLaunchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [buyState, setBuyState] = useState<"idle" | "approving" | "buying" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // Tick every second only while the anti-snipe window could still be
  // active, so the countdown badge stays accurate without polling forever.
  useEffect(() => {
    if (launchedAt === null) return;
    const secondsLeft = ANTI_SNIPE_WINDOW_SECONDS - (now / 1000 - launchedAt);
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [now, launchedAt]);

  async function toggleOpen(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    setError(null);
    if (poolAddress !== null) return; // already resolved from a previous open
    setChecking(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [pool, launchTs] = await Promise.all([
        client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "tokenPool", args: [token.address as `0x${string}`] }),
        client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "launchedAt", args: [token.address as `0x${string}`] }),
      ]);
      setLaunchedAt(Number(launchTs));
      if (pool === "0x0000000000000000000000000000000000000000") {
        setPoolAddress("none");
      } else {
        const pTokenA = await client.readContract({ address: pool, abi: POOL_QUOTE_ABI, functionName: "tokenA" });
        setPoolAddress(pool);
        setUsdcIsTokenA((pTokenA as string).toLowerCase() === USDC_ADDRESS.toLowerCase());
      }
    } catch {
      setError("Couldn't check whether this token is tradeable yet.");
      setPoolAddress("none");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!open || !poolAddress || poolAddress === "none" || !amount) { setQuote(null); return; }
    const num = Number(amount);
    if (isNaN(num) || num <= 0) { setQuote(null); return; }
    const handle = setTimeout(async () => {
      setQuoting(true);
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const out = await client.readContract({ address: poolAddress, abi: POOL_QUOTE_ABI, functionName: "getAmountOut", args: [usdcIsTokenA, parseUnits(amount, 6)] });
        setQuote(formatUnits(out as bigint, 18));
      } catch {
        setQuote(null);
      } finally {
        setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [amount, poolAddress, usdcIsTokenA, open]);

  async function doBuy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const num = Number(amount);
    if (!amount || isNaN(num) || num <= 0) { setError("Enter a USDC amount greater than 0."); return; }
    if (!quote) { setError("Still fetching a quote — try again in a moment."); return; }
    setError(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const usdcIn = parseUnits(amount, 6);
      // 5% slippage tolerance off the quote taken moments ago. The
      // contract's own anti-snipe cap can also reject this outright if
      // the buy is too large for the launch window — that surfaces as a
      // plain revert message below, same as any other failed write.
      const minTokenOut = (parseUnits(quote, 18) * 95n) / 100n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

      setBuyState("approving");
      const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: ERC20_APPROVE_ABI, functionName: "approve", args: [TOKEN_FACTORY, usdcIn], account: address as `0x${string}` });
      await waitForSuccess(publicClient, approveHash);

      setBuyState("buying");
      const buyHash = await wc.writeContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "buyDuringLaunch", args: [token.address as `0x${string}`, usdcIn, minTokenOut, deadline], account: address as `0x${string}` });
      await waitForSuccess(publicClient, buyHash);

      setBuyState("done");
      showToast(`Bought ${token.symbol}`, "success");
      setAmount("");
    } catch (e2: unknown) {
      const err = e2 as { message?: string };
      setError(err.message ?? "Buy failed.");
      setBuyState("idle");
    }
  }

  const secondsLeft = launchedAt !== null ? Math.max(0, Math.ceil(ANTI_SNIPE_WINDOW_SECONDS - (now / 1000 - launchedAt))) : null;

  return (
    <div onClick={(e) => e.preventDefault()} style={{ marginTop: 8 }}>
      <button onClick={toggleOpen}
        style={{ width: "100%", padding: "0.45rem", borderRadius: 8, border: "none", background: open ? "#EDE9FE" : "#7c3aed", color: open ? "#5B21B6" : "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
        {open ? "Cancel" : "Buy"}
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: "0.75rem", borderRadius: 10, background: "#F9FAFB", border: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 8 }}>
          {checking && <div style={{ fontSize: 11, color: "#6B7280" }}>Checking pool...</div>}

          {!checking && poolAddress === "none" && (
            <div style={{ fontSize: 11, color: "#DC2626" }}>Not tradeable yet — no pool exists for this token.</div>
          )}

          {!checking && poolAddress && poolAddress !== "none" && (
            <>
              {secondsLeft !== null && secondsLeft > 0 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FEF3C7", borderRadius: 6, padding: "3px 6px", alignSelf: "flex-start" }}>
                  Anti-snipe window: {secondsLeft}s left — buy size may be capped
                </div>
              )}
              <input type="number" placeholder="USDC amount" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={buyState !== "idle" && buyState !== "done"}
                style={{ padding: "0.5rem 0.7rem", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12, color: "#111827" }} />
              <div style={{ fontSize: 11, color: "#4B5563" }}>
                {quoting ? "Quoting..." : quote ? `≈ ${Number(quote).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${token.symbol}` : "Enter an amount for a quote"}
              </div>
              {error && <div style={{ fontSize: 11, color: "#DC2626", wordBreak: "break-word" }}>{error}</div>}
              <button onClick={doBuy} disabled={buyState === "approving" || buyState === "buying" || !amount}
                style={{ padding: "0.5rem", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 700, cursor: buyState === "approving" || buyState === "buying" ? "not-allowed" : "pointer", opacity: buyState === "approving" || buyState === "buying" ? 0.6 : 1 }}>
                {buyState === "approving" ? "Approving..." : buyState === "buying" ? "Buying..." : buyState === "done" ? "Bought — buy more?" : "Confirm buy"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function TokenLaunch({ provider, address }: Props) {
  const isMobile = useIsMobile();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000");
  const [showDetails, setShowDetails] = useState(false);
  const [description, setDescription] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [telegram, setTelegram] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [state, setState] = useState<"idle" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [lockState, setLockState] = useState<"idle" | "checking" | "no-pool" | "creating-pool" | "ready" | "locking" | "locked">("idle");
  const [lockPoolAddress, setLockPoolAddress] = useState<`0x${string}` | null>(null);
  const [lockTokenAmount, setLockTokenAmount] = useState("");
  const [lockUsdcAmount, setLockUsdcAmount] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);

  const [flowStep, setFlowStep] = useState<FlowStep>("form");
  const [newTokenAddress, setNewTokenAddress] = useState<string | null>(null);
  const [newTokenSymbol, setNewTokenSymbol] = useState<string>("");

  const [allTokens, setAllTokens] = useState<LaunchedToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [metadata, setMetadata] = useState<Record<string, TokenMetadata>>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LaunchedToken[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  function isAddressLike(q: string) {
    return q.trim().startsWith("0x") && q.trim().length >= 10;
  }

  async function doSearchToken() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });

      if (isAddressLike(q)) {
        const addr = q as `0x${string}`;
        const [tName, tSymbol, supply, creator] = await Promise.all([
          client.readContract({ address: addr, abi: TOKEN_ABI, functionName: "name" }),
          client.readContract({ address: addr, abi: TOKEN_ABI, functionName: "symbol" }),
          client.readContract({ address: addr, abi: TOKEN_ABI, functionName: "totalSupply" }),
          client.readContract({ address: addr, abi: TOKEN_ABI, functionName: "creator" }),
        ]);
        setSearchResults([{ address: addr, name: tName, symbol: tSymbol, supply: Number(formatUnits(supply, 18)).toLocaleString(), creator }]);
        fetchTokenMetadata([addr]).then((m) => setMetadata((prev) => ({ ...prev, ...m })));
        return;
      }

      const needle = q.toLowerCase();
      const count = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokensLength" });
      const total = Number(count);
      const matches: LaunchedToken[] = [];

      for (let i = total - 1; i >= 0 && matches.length < 20; i--) {
        const tokenAddr = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokens", args: [BigInt(i)] });
        const [tName, tSymbol] = await Promise.all([
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "name" }),
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "symbol" }),
        ]);
        if (tName.toLowerCase().includes(needle) || tSymbol.toLowerCase().includes(needle)) {
          const [supply, creator] = await Promise.all([
            client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "totalSupply" }),
            client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "creator" }),
          ]);
          matches.push({ address: tokenAddr, name: tName, symbol: tSymbol, supply: Number(formatUnits(supply, 18)).toLocaleString(), creator });
        }
        await new Promise(r => setTimeout(r, 30));
      }

      if (matches.length === 0) setSearchError("No tokens matched that name or symbol.");
      setSearchResults(matches);
      fetchTokenMetadata(matches.map((m) => m.address)).then((m) => setMetadata((prev) => ({ ...prev, ...m })));
    } catch {
      setSearchError("Token not found.");
    } finally {
      setSearching(false);
    }
  }

  async function addTokenToWallet(tokenAddress: string, tokenSymbol: string) {
    try {
      await provider.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: { address: tokenAddress, symbol: tokenSymbol.slice(0, 11), decimals: 18 },
        },
      } as any);
      showToast("Token added to wallet", "success");
    } catch {
      showToast("Could not add token — add it manually", "error");
    }
  }

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    setAllTokens([]);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const count = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokensLength" });
      const total = Number(count);
      const start = total > 10 ? total - 10 : 0;
      const indices: number[] = [];
      for (let i = total - 1; i >= start; i--) indices.push(i);

      const addrs = await Promise.all(
        indices.map(i => client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokens", args: [BigInt(i)] }))
      );

      await Promise.all(addrs.map(async (tokenAddr) => {
        try {
          const [tName, tSymbol, supply, creator] = await Promise.all([
            client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "name" }),
            client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "symbol" }),
            client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "totalSupply" }),
            client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "creator" }),
          ]);
          const entry = { address: tokenAddr, name: tName, symbol: tSymbol, supply: Number(formatUnits(supply, 18)).toLocaleString(), creator };
          setAllTokens(prev => [...prev, entry].sort((a, b) => addrs.indexOf(a.address as any) - addrs.indexOf(b.address as any)));
        } catch {
          /* skip token that fails to resolve */
        }
      }));
      fetchTokenMetadata(addrs as string[]).then((m) => setMetadata((prev) => ({ ...prev, ...m })));
    } catch {
      setAllTokens([]);
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  async function doLaunch() {
    if (!name.trim() || !symbol.trim()) { setErrorMsg("Enter both a name and symbol."); return; }
    if (symbol.length > 10) { setErrorMsg("Symbol must be 10 characters or fewer."); return; }
    const supplyNum = Number(supply);
    if (!supply || isNaN(supplyNum) || supplyNum <= 0) { setErrorMsg("Enter a supply greater than 0."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      setState("processing");
      const supplyUnits = parseUnits(supply, 18);
      const hash = await wc.writeContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "launchToken", args: [name.trim(), symbol.trim().toUpperCase(), supplyUnits], account: address as `0x${string}` });
      await waitForSuccess(publicClient, hash);

      const count = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokensLength" });
      const newAddr = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokens", args: [count - 1n] });

      setNewTokenAddress(newAddr);
      setNewTokenSymbol(symbol.trim().toUpperCase());
      setFlowStep("created");
      setState("idle"); setName(""); setSymbol(""); setSupply("1000000");
      showToast("Token launched", "success");
      await loadTokens();

      // Optional metadata (description/socials/image) is purely cosmetic —
      // save it if the creator filled any of it in, but never let a
      // failure here affect the "token launched" success state above.
      if (description.trim() || xHandle.trim() || telegram.trim() || imageUrl.trim()) {
        try {
          const message = `Set FlowFi token metadata for ${(newAddr as string).toLowerCase()}`;
          const signature = await wc.signMessage({ account: address as `0x${string}`, message });
          const res = await fetch("/api/token-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save", token: newAddr, creator: address, signature, description: description.trim(), xHandle: xHandle.trim(), telegram: telegram.trim(), imageUrl: imageUrl.trim() }),
          });
          const data = await res.json();
          if (data.success) setMetadata((prev) => ({ ...prev, [(newAddr as string).toLowerCase()]: data.metadata }));
        } catch {
          /* cosmetic metadata save failed — the token itself still launched fine, nothing to surface to the user here */
        }
      }
      setDescription(""); setXHandle(""); setTelegram(""); setImageUrl(""); setShowDetails(false);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to launch token."); setState("error");
    }
  }

  // After launch, check whether a pool exists yet for this token. Two ways
  // one can exist: FlowFi's curated factory (v4c — owner-created, legacy
  // path), or ArcLaunchPoolFactory (permissionless — the creator can open
  // it themselves below, no owner approval needed). If one exists and
  // liquidity hasn't been locked yet, the creator can lock it below.
  useEffect(() => {
    if (flowStep !== "created" || !newTokenAddress) { setLockState("idle"); return; }
    async function checkPool() {
      setLockState("checking");
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const alreadyLocked = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "tokenPool", args: [newTokenAddress as `0x${string}`] });
        if (alreadyLocked !== "0x0000000000000000000000000000000000000000") {
          setLockState("locked");
          return;
        }
        const curatedPool = await client.readContract({ address: POOL_FACTORY_V4C, abi: POOL_FACTORY_ABI, functionName: "getPool", args: [newTokenAddress as `0x${string}`, USDC_ADDRESS] });
        if (curatedPool !== "0x0000000000000000000000000000000000000000") {
          setLockPoolAddress(curatedPool);
          setLockState("ready");
          return;
        }
        const launchPool = await client.readContract({ address: LAUNCH_POOL_FACTORY, abi: LAUNCH_POOL_FACTORY_ABI, functionName: "getPool", args: [newTokenAddress as `0x${string}`] });
        if (launchPool !== "0x0000000000000000000000000000000000000000") {
          setLockPoolAddress(launchPool);
          setLockState("ready");
        } else {
          setLockState("no-pool");
        }
      } catch {
        setLockState("no-pool");
      }
    }
    checkPool();
  }, [flowStep, newTokenAddress]);

  // Permissionless — the creator opens their own pool instead of waiting
  // for FlowFi to do it. Only works because ArcLaunchPoolFactory itself
  // verifies on-chain that this token was really minted through Token
  // Factory (see the contract's own comments) — this call can't be used to
  // spin up a pool for an arbitrary/unrelated token.
  async function doCreateLaunchPool() {
    if (!newTokenAddress) return;
    setLockState("creating-pool");
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const hash = await wc.writeContract({ address: LAUNCH_POOL_FACTORY, abi: LAUNCH_POOL_FACTORY_ABI, functionName: "createLaunchPool", args: [newTokenAddress as `0x${string}`], account: address as `0x${string}` });
      await waitForSuccess(publicClient, hash);
      const pool = await publicClient.readContract({ address: LAUNCH_POOL_FACTORY, abi: LAUNCH_POOL_FACTORY_ABI, functionName: "getPool", args: [newTokenAddress as `0x${string}`] });
      setLockPoolAddress(pool);
      setLockState("ready");
      showToast("Pool created", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast(err.message ?? "Failed to create pool.", "error");
      setLockState("no-pool");
    }
  }

  async function doLockLiquidity() {
    if (!newTokenAddress || !lockPoolAddress) return;
    const tokenNum = Number(lockTokenAmount);
    const usdcNum = Number(lockUsdcAmount);
    if (!lockTokenAmount || isNaN(tokenNum) || tokenNum <= 0) { setLockError("Enter a token amount greater than 0."); return; }
    if (!lockUsdcAmount || isNaN(usdcNum) || usdcNum <= 0) { setLockError("Enter a USDC amount greater than 0."); return; }
    setLockError(null);
    try {
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const tokenAmountUnits = parseUnits(lockTokenAmount, 18);
      const usdcAmountUnits = parseUnits(lockUsdcAmount, 6);

      setLockState("locking");
      const approve1 = await wc.writeContract({ address: newTokenAddress as `0x${string}`, abi: ERC20_APPROVE_ABI, functionName: "approve", args: [TOKEN_FACTORY, tokenAmountUnits], account: address as `0x${string}` });
      await waitForSuccess(publicClient, approve1);
      const approve2 = await wc.writeContract({ address: USDC_ADDRESS, abi: ERC20_APPROVE_ABI, functionName: "approve", args: [TOKEN_FACTORY, usdcAmountUnits], account: address as `0x${string}` });
      await waitForSuccess(publicClient, approve2);

      const hash = await wc.writeContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "lockLaunchLiquidity", args: [newTokenAddress as `0x${string}`, lockPoolAddress, tokenAmountUnits, usdcAmountUnits, deadline], account: address as `0x${string}` });
      await waitForSuccess(publicClient, hash);

      setLockState("locked");
      showToast("Liquidity locked permanently", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setLockError(err.message ?? "Failed to lock liquidity."); setLockState("ready");
    }
  }

  function startOver() {
    setFlowStep("form");
    setNewTokenAddress(null);
    setNewTokenSymbol("");
    setErrorMsg(null);
  }

  const isLoading = state === "processing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: isMobile ? 460 : 640, margin: isMobile ? undefined : "0 auto" }}>
      <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#5B21B6", margin: 0 }}>
          Deploy your own ERC20 on Arc with a supply you choose, minted entirely to your wallet. Once the FlowFi team sets up a trading pool for it, you can permanently lock your own launch liquidity — nobody, including FlowFi, can ever withdraw it afterward.
        </p>
      </div>

      {flowStep === "form" && (
        <div style={{ background: "#ffffff", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>Token Name</label>
            <input type="text" placeholder="e.g. My Token" value={name} onChange={(e) => setName(e.target.value)} disabled={isLoading} maxLength={32}
              style={{ background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 15, color: "#111827", outline: "none" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>Symbol</label>
            <input type="text" placeholder="e.g. MTK" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={isLoading} maxLength={10}
              style={{ background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 15, color: "#111827", outline: "none" }} />
          </div>
          {symbol && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: avatarColor(symbol), color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {symbol.slice(0, 2)}
              </div>
              <span style={{ fontSize: 12.5, color: "#4B5563" }}>{name || "Your token"} <span style={{ fontFamily: "ui-monospace, monospace", color: "#111827", fontWeight: 700 }}>{symbol}</span></span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>Initial Supply</label>
            <input type="number" placeholder="1000000" value={supply} onChange={(e) => setSupply(e.target.value)} disabled={isLoading} min="1"
              style={{ background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 15, color: "#111827", outline: "none" }} />
          </div>
          <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.7rem 0.9rem", fontSize: 12, color: "#4B5563", display: "flex", justifyContent: "space-between" }}>
            <span>Minted entirely to your wallet: <span style={{ color: "#111827", fontWeight: 700 }}>{supply ? Number(supply).toLocaleString() : "0"} {symbol || "TOKEN"}</span></span>
            <span style={{ color: "#9CA3AF" }}>18 decimals (fixed)</span>
          </div>

          <button type="button" onClick={() => setShowDetails(!showDetails)}
            style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, color: "#7c3aed", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
            {showDetails ? "− Hide details" : "+ Add description, socials & image (optional)"}
          </button>
          {showDetails && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#FAFAFA", borderRadius: 10, padding: "0.85rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={isLoading} maxLength={280} rows={2}
                  placeholder="What is this token for?"
                  style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none", resize: "vertical", fontFamily: "inherit" }} />
                <span style={{ fontSize: 10, color: "#9CA3AF", alignSelf: "flex-end" }}>{description.length}/280</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#6B7280" }}>X handle</label>
                  <input type="text" value={xHandle} onChange={(e) => setXHandle(e.target.value)} disabled={isLoading} maxLength={60} placeholder="@handle"
                    style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none" }} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#6B7280" }}>Telegram</label>
                  <input type="text" value={telegram} onChange={(e) => setTelegram(e.target.value)} disabled={isLoading} maxLength={60} placeholder="t.me/community"
                    style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none" }} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>Image URL</label>
                <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} disabled={isLoading} maxLength={500} placeholder="https://..."
                  style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none" }} />
                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>Link to an already-hosted image (e.g. Imgur) — no upload yet, paste a URL.</span>
              </div>
              <p style={{ fontSize: 10.5, color: "#9CA3AF", margin: 0 }}>Saved after launch, tied to your wallet's signature — this never touches the token contract itself.</p>
            </div>
          )}
          {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}
          <button onClick={doLaunch} disabled={isLoading}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "#7c3aed", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
            {isLoading ? "Launching..." : "Launch Token"}
          </button>
        </div>
      )}

      {flowStep === "created" && newTokenAddress && (
        <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 16, padding: "1.75rem", textAlign: "center" }}>
          {metadata[newTokenAddress.toLowerCase()]?.imageUrl ? (
            <img src={metadata[newTokenAddress.toLowerCase()].imageUrl} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", marginBottom: 10 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ fontSize: 36, marginBottom: 10 }}>🚀</div>
          )}
          <p style={{ color: "#16A34A", fontWeight: 800, fontSize: 17, margin: "0 0 6px 0" }}>{newTokenSymbol} is live!</p>
          <p style={{ fontSize: 11, color: "#4B5563", fontFamily: "monospace", margin: "0 0 16px 0", wordBreak: "break-all" }}>{newTokenAddress}</p>
          {metadata[newTokenAddress.toLowerCase()]?.description && (
            <p style={{ fontSize: 12.5, color: "#374151", margin: "0 0 16px 0", textAlign: "left", background: "#fff", borderRadius: 8, padding: "0.6rem 0.8rem" }}>
              {metadata[newTokenAddress.toLowerCase()].description}
            </p>
          )}
          <button onClick={() => addTokenToWallet(newTokenAddress, newTokenSymbol)}
            style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "1px solid rgba(109,94,247,0.15)", background: "rgba(109,94,247,0.05)", color: "#111827", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
            + Add {newTokenSymbol} to Wallet
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`https://testnet.arcscan.app/address/${newTokenAddress}`} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(109,94,247,0.15)", background: "transparent", color: "#6B7280", fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none", textAlign: "center" }}>
              View on Explorer
            </a>
            <button onClick={startOver}
              style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #059669, #10b981)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Launch Another
            </button>
          </div>

          <div style={{ marginTop: 16, textAlign: "left", background: "#ffffff", borderRadius: 12, padding: "1rem" }}>
            <div style={{ fontSize: 12.5, color: "#111827", fontWeight: 700, marginBottom: 4 }}>Want to make the first buy?</div>
            <p style={{ fontSize: 11.5, color: "#6B7280", margin: "0 0 4px 0" }}>Once a trading pool exists for {newTokenSymbol}, you can buy in here — same anti-snipe protection as anyone else.</p>
            <TokenBuyPanel token={{ address: newTokenAddress, symbol: newTokenSymbol }} provider={provider} address={address} />
          </div>

          {lockState === "checking" && (
            <div style={{ marginTop: 16, fontSize: 12, color: "#6B7280" }}>Checking whether a trading pool exists yet...</div>
          )}
          {(lockState === "no-pool" || lockState === "creating-pool") && (
            <div style={{ marginTop: 16, background: "rgba(109,94,247,0.08)", borderRadius: 10, padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 12, color: "#5B21B6", margin: 0 }}>No trading pool yet for {newTokenSymbol}. Open one yourself — no approval needed, since {newTokenSymbol} was launched here.</p>
              <button onClick={doCreateLaunchPool} disabled={lockState === "creating-pool"}
                style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: lockState === "creating-pool" ? "not-allowed" : "pointer", opacity: lockState === "creating-pool" ? 0.6 : 1 }}>
                {lockState === "creating-pool" ? "Creating pool..." : "Create your pool now"}
              </button>
            </div>
          )}
          {lockState === "locked" && (
            <div style={{ marginTop: 16, background: "rgba(16,185,129,0.1)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 12, color: "#16A34A", fontWeight: 700 }}>
              ✓ Liquidity locked permanently — nobody, including FlowFi, can withdraw it.
            </div>
          )}
          {(lockState === "ready" || lockState === "locking") && (
            <div style={{ marginTop: 16, textAlign: "left", background: "#ffffff", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12.5, color: "#111827", fontWeight: 700 }}>Lock launch liquidity</div>
              <p style={{ fontSize: 11.5, color: "#6B7280", margin: 0 }}>This is a one-time, permanent deposit — the resulting pool shares can never be withdrawn by anyone, including FlowFi.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>{newTokenSymbol} amount</label>
                <input type="number" placeholder="0.0" value={lockTokenAmount} onChange={(e) => setLockTokenAmount(e.target.value)} disabled={lockState === "locking"}
                  style={{ background: "#f5f3ff", border: "none", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 14, color: "#111827", outline: "none" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>USDC amount</label>
                <input type="number" placeholder="0.0" value={lockUsdcAmount} onChange={(e) => setLockUsdcAmount(e.target.value)} disabled={lockState === "locking"}
                  style={{ background: "#f5f3ff", border: "none", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 14, color: "#111827", outline: "none" }} />
              </div>
              {lockError && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#DC2626", fontSize: 12 }}>{lockError}</div>}
              <button onClick={doLockLiquidity} disabled={lockState === "locking"}
                style={{ width: "100%", padding: "0.8rem", borderRadius: 10, border: "none", background: "#7c3aed", color: "#fff", fontSize: 14, fontWeight: 700, cursor: lockState === "locking" ? "not-allowed" : "pointer", opacity: lockState === "locking" ? 0.6 : 1 }}>
                {lockState === "locking" ? "Locking..." : "Lock Liquidity Permanently"}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ background: "#ffffff", borderRadius: 14, padding: "1rem", display: "flex", flexDirection: "column", gap: 10 , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px" }}>SEARCH BY NAME OR ADDRESS</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="Doge, DOGE, or 0x..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSearchToken(); }}
            style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: 13, color: "#111827", outline: "none" }} />
          <button onClick={doSearchToken} disabled={searching}
            style={{ padding: "0.6rem 1.1rem", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: searching ? "not-allowed" : "pointer", opacity: searching ? 0.6 : 1 }}>
            {searching ? "..." : "Search"}
          </button>
        </div>
        {searchError && <div style={{ fontSize: 12, color: "#DC2626" }}>{searchError}</div>}
        {searchResults.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {searchResults.map((r) => {
              const meta = metadata[r.address.toLowerCase()];
              return (
                <div key={r.address} style={{ padding: "0.65rem 0.9rem", borderRadius: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <a href={`https://testnet.arcscan.app/address/${r.address}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {meta?.imageUrl ? (
                        <img src={meta.imageUrl} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: avatarColor(r.symbol), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                          {r.symbol[0]}
                        </div>
                      )}
                      <div>
                        <span style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>{r.name}</span>
                        <span style={{ fontSize: 11, color: "#4B5563", marginLeft: 6 }}>{r.symbol}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: "#16A34A" }}>{r.supply} supply</span>
                  </a>
                  {meta?.description && <p style={{ fontSize: 11, color: "#4B5563", margin: "6px 0 0 0" }}>{meta.description}</p>}
                  {(meta?.xHandle || meta?.telegram) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      {meta.xHandle && <a href={`https://x.com/${meta.xHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: "#6D5EF7", textDecoration: "none" }}>𝕏 {meta.xHandle}</a>}
                      {meta.telegram && <a href={meta.telegram.startsWith("http") ? meta.telegram : `https://t.me/${meta.telegram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: "#6D5EF7", textDecoration: "none" }}>Telegram</a>}
                    </div>
                  )}
                  <TokenBuyPanel token={r} provider={provider} address={address} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, color: "#111827", fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>RECENTLY LAUNCHED</div>
        {loadingTokens && <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>}
        {!loadingTokens && allTokens.length === 0 && <div style={{ fontSize: 12, color: "#334155" }}>No tokens launched yet. Be the first!</div>}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
          {allTokens.map((t) => {
            const color = avatarColor(t.symbol);
            const meta = metadata[t.address.toLowerCase()];
            return (
              <div key={t.address}
                style={{ display: "block", padding: "1rem", borderRadius: 16, background: `linear-gradient(160deg, ${color}10, #ffffff)`, border: `1px solid ${color}30`, boxShadow: `0 2px 8px ${color}15` }}>
                <a href={`https://testnet.arcscan.app/address/${t.address}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    {meta?.imageUrl ? (
                      <img src={meta.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 14, objectFit: "cover", flexShrink: 0, boxShadow: `0 4px 10px ${color}40` }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg, ${color}, ${color}AA)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 17, fontWeight: 800, flexShrink: 0, boxShadow: `0 4px 10px ${color}40` }}>
                        {t.symbol[0]}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: "#111827", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>${t.symbol}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}18`, padding: "3px 8px", borderRadius: 6 }}>LAUNCHED</span>
                    <span className="flowfi-mono" style={{ fontSize: 10, color: "#9CA3AF" }}>{t.address.slice(0, 6)}...{t.address.slice(-4)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, marginTop: 6 }}>{t.supply} supply</div>
                  {meta?.description && (
                    <div style={{ fontSize: 10.5, color: "#6B7280", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                      {meta.description}
                    </div>
                  )}
                  {(meta?.xHandle || meta?.telegram) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      {meta.xHandle && <span style={{ fontSize: 10, color, fontWeight: 600 }}>𝕏 {meta.xHandle}</span>}
                      {meta.telegram && <span style={{ fontSize: 10, color, fontWeight: 600 }}>Telegram</span>}
                    </div>
                  )}
                </a>
                <TokenBuyPanel token={t} provider={provider} address={address} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

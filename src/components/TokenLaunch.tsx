import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";

const TOKEN_FACTORY = "0x481E8919f79A4DA6446EA78cEa70037acB9c85A1" as `0x${string}`;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const POOL_FACTORY = "0xE610D2f76547c2a3073e1273E7BFA80d395eCDf8" as `0x${string}`;

const TOKEN_FACTORY_ABI = [
  { type: "function", name: "launchToken", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }], outputs: [{ name: "token", type: "address" }] },
  { type: "function", name: "allTokensLength", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allTokens", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

const TOKEN_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_FACTORY_ABI = [
  { type: "function", name: "createPool", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "pool", type: "address" }] },
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

const POOL_ABI = [
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
  onNavigateToPools: () => void;
}

interface LaunchedToken {
  address: string;
  name: string;
  symbol: string;
  supply: string;
  creator: string;
}

type FlowStep = "form" | "created" | "pool_created" | "liquidity_added";

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

export default function TokenLaunch({ provider, address, onNavigateToPools }: Props) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [state, setState] = useState<"idle" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [flowStep, setFlowStep] = useState<FlowStep>("form");
  const [newTokenAddress, setNewTokenAddress] = useState<string | null>(null);
  const [newTokenSymbol, setNewTokenSymbol] = useState<string>("");
  const [poolAddress, setPoolAddress] = useState<string | null>(null);

  const [poolTokenAmount, setPoolTokenAmount] = useState("1000");
  const [poolUsdcAmount, setPoolUsdcAmount] = useState("10");

  const [allTokens, setAllTokens] = useState<LaunchedToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);

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
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      setState("processing");
      const hash = await wc.writeContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "launchToken", args: [name.trim(), symbol.trim().toUpperCase()], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      const count = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokensLength" });
      const newAddr = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "allTokens", args: [count - 1n] });

      setNewTokenAddress(newAddr);
      setNewTokenSymbol(symbol.trim().toUpperCase());
      setFlowStep("created");
      setState("idle"); setName(""); setSymbol("");
      showToast("Token launched", "success");
      await loadTokens();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to launch token."); setState("error");
    }
  }

  async function doCreatePool() {
    if (!newTokenAddress) return;
    setErrorMsg(null); setState("processing");
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      const existing = await publicClient.readContract({ address: POOL_FACTORY, abi: POOL_FACTORY_ABI, functionName: "getPool", args: [newTokenAddress as `0x${string}`, USDC_ADDRESS] });
      let pool = existing;
      if (existing === "0x0000000000000000000000000000000000000000") {
        const hash = await wc.writeContract({ address: POOL_FACTORY, abi: POOL_FACTORY_ABI, functionName: "createPool", args: [newTokenAddress as `0x${string}`, USDC_ADDRESS], account: address as `0x${string}` });
        await publicClient.waitForTransactionReceipt({ hash });
        pool = await publicClient.readContract({ address: POOL_FACTORY, abi: POOL_FACTORY_ABI, functionName: "getPool", args: [newTokenAddress as `0x${string}`, USDC_ADDRESS] });
      }

      setPoolAddress(pool);
      setFlowStep("pool_created");
      setState("idle");
      showToast("Pool created", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to create pool."); setState("error");
    }
  }

  async function doAddLiquidity() {
    if (!poolAddress || !newTokenAddress) return;
    if (!poolTokenAmount || !poolUsdcAmount || Number(poolTokenAmount) <= 0 || Number(poolUsdcAmount) <= 0) {
      setErrorMsg("Enter valid amounts for both tokens."); return;
    }
    setErrorMsg(null); setState("processing");
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      const tokenA = await publicClient.readContract({ address: poolAddress as `0x${string}`, abi: POOL_ABI, functionName: "tokenA" });
      const newTokenIsA = tokenA.toLowerCase() === newTokenAddress.toLowerCase();

      const tokenUnits = parseUnits(poolTokenAmount, 18);
      const usdcUnits = parseUnits(poolUsdcAmount, 6);

      const a1 = await wc.writeContract({ address: newTokenAddress as `0x${string}`, abi: erc20Abi, functionName: "approve", args: [poolAddress as `0x${string}`, tokenUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      const a2 = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [poolAddress as `0x${string}`, usdcUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a2 });

      const hash = await wc.writeContract({
        address: poolAddress as `0x${string}`, abi: POOL_ABI, functionName: "addLiquidity",
        args: newTokenIsA ? [tokenUnits, usdcUnits] : [usdcUnits, tokenUnits],
        account: address as `0x${string}`,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setFlowStep("liquidity_added");
      setState("idle");
      showToast("Liquidity added", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to add liquidity."); setState("error");
    }
  }

  function startOver() {
    setFlowStep("form");
    setNewTokenAddress(null);
    setNewTokenSymbol("");
    setPoolAddress(null);
    setPoolTokenAmount("1000");
    setPoolUsdcAmount("10");
    setErrorMsg(null);
  }

  const isLoading = state === "processing";

  const steps = [
    { key: "created", label: "Token Created", done: flowStep !== "form" },
    { key: "pool_created", label: "Pool Created", done: flowStep === "pool_created" || flowStep === "liquidity_added" },
    { key: "liquidity_added", label: "Liquidity Added", done: flowStep === "liquidity_added" },
    { key: "trade", label: "Trade", done: flowStep === "liquidity_added" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 460 }}>
      <div style={{ background: "rgba(79,70,229,0.05)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#a5b4fc", margin: 0 }}>
          Launch your own ERC20 token, pair it against USDC, and seed liquidity — all in one flow.
        </p>
      </div>

      {flowStep !== "form" && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {steps.map((s, i) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: s.done ? "#10b981" : "rgba(255,255,255,0.06)", color: s.done ? "#fff" : "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
                  {s.done ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 9, color: s.done ? "#6ee7b7" : "#475569", marginTop: 4, textAlign: "center" }}>{s.label}</span>
              </div>
              {i < steps.length - 1 && <div style={{ height: 2, flex: 1, background: s.done ? "#10b981" : "rgba(255,255,255,0.08)", marginBottom: 14 }} />}
            </div>
          ))}
        </div>
      )}

      {flowStep === "form" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Token Name</label>
            <input type="text" placeholder="e.g. Arc Doge" value={name} onChange={(e) => setName(e.target.value)} disabled={isLoading} maxLength={32}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 15, color: "#f1f5f9", outline: "none" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Symbol</label>
            <input type="text" placeholder="e.g. ADOGE" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={isLoading} maxLength={10}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 15, color: "#f1f5f9", outline: "none" }} />
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "0.7rem 0.9rem", fontSize: 12, color: "#64748b" }}>
            Initial supply: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>1,000,000 {symbol || "TOKEN"}</span> — minted entirely to your wallet
          </div>
          {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}
          <button onClick={doLaunch} disabled={isLoading}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
            {isLoading ? "Launching..." : "Launch Token"}
          </button>
        </div>
      )}

      {flowStep === "created" && newTokenAddress && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚀</div>
            <p style={{ color: "#6ee7b7", fontWeight: 800, fontSize: 16, margin: "0 0 4px 0" }}>{newTokenSymbol} is live!</p>
            <p style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", margin: 0, wordBreak: "break-all" }}>{newTokenAddress}</p>
          </div>
          <button onClick={() => addTokenToWallet(newTokenAddress, newTokenSymbol)}
            style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Add {newTokenSymbol} to Wallet

import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, formatUnits } from "viem";
import { waitForSuccess } from "../txHelpers";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { useIsMobile } from "../useIsMobile";
import { showToast } from "../toast";

const TOKEN_FACTORY = "0x481E8919f79A4DA6446EA78cEa70037acB9c85A1" as `0x${string}`;

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

export default function TokenLaunch({ provider, address }: Props) {
  const isMobile = useIsMobile();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [state, setState] = useState<"idle" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [flowStep, setFlowStep] = useState<FlowStep>("form");
  const [newTokenAddress, setNewTokenAddress] = useState<string | null>(null);
  const [newTokenSymbol, setNewTokenSymbol] = useState<string>("");

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
      await waitForSuccess(publicClient, hash);

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
          Deploy your own ERC20 on Arc. Supply is fixed at 1,000,000 tokens per launch, minted entirely to your wallet. Trading pools are set up by the FlowFi team for major assets — this just mints your token.
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
          <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.7rem 0.9rem", fontSize: 12, color: "#4B5563", display: "flex", justifyContent: "space-between" }}>
            <span>Initial supply: <span style={{ color: "#111827", fontWeight: 700 }}>1,000,000 {symbol || "TOKEN"}</span> — minted entirely to your wallet</span>
            <span style={{ color: "#9CA3AF" }}>18 decimals (fixed)</span>
          </div>
          {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}
          <button onClick={doLaunch} disabled={isLoading}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "#7c3aed", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
            {isLoading ? "Launching..." : "Launch Token"}
          </button>
        </div>
      )}

      {flowStep === "created" && newTokenAddress && (
        <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 16, padding: "1.75rem", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🚀</div>
          <p style={{ color: "#16A34A", fontWeight: 800, fontSize: 17, margin: "0 0 6px 0" }}>{newTokenSymbol} is live!</p>
          <p style={{ fontSize: 11, color: "#4B5563", fontFamily: "monospace", margin: "0 0 16px 0", wordBreak: "break-all" }}>{newTokenAddress}</p>
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
            {searchResults.map((r) => (
              <a key={r.address} href={`https://testnet.arcscan.app/address/${r.address}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.9rem", borderRadius: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: avatarColor(r.symbol), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                    {r.symbol[0]}
                  </div>
                  <div>
                    <span style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>{r.name}</span>
                    <span style={{ fontSize: 11, color: "#4B5563", marginLeft: 6 }}>{r.symbol}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#16A34A" }}>{r.supply} supply</span>
              </a>
            ))}
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
            return (
              <a key={t.address} href={`https://testnet.arcscan.app/address/${t.address}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", padding: "1rem", borderRadius: 16, background: `linear-gradient(160deg, ${color}10, #ffffff)`, border: `1px solid ${color}30`, textDecoration: "none", boxShadow: `0 2px 8px ${color}15` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg, ${color}, ${color}AA)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 17, fontWeight: 800, flexShrink: 0, boxShadow: `0 4px 10px ${color}40` }}>
                    {t.symbol[0]}
                  </div>
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
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

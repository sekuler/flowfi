import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";

const TOKEN_FACTORY = "0x481E8919f79A4DA6446EA78cEa70037acB9c85A1" as `0x${string}`;

const FACTORY_ABI = [
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

interface LaunchedToken {
  address: string;
  name: string;
  symbol: string;
  supply: string;
  creator: string;
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

export default function TokenLaunch({ provider, address }: Props) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [state, setState] = useState<"idle" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [launchedToken, setLaunchedToken] = useState<{ address: string; name: string; symbol: string } | null>(null);
  const [allTokens, setAllTokens] = useState<LaunchedToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const count = await client.readContract({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "allTokensLength" });
      const loaded: LaunchedToken[] = [];
      const total = Number(count);
      const start = total > 10 ? total - 10 : 0; // show most recent 10
      for (let i = total - 1; i >= start; i--) {
        const tokenAddr = await client.readContract({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "allTokens", args: [BigInt(i)] });
        const [tName, tSymbol, supply, creator] = await Promise.all([
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "name" }),
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "symbol" }),
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "totalSupply" }),
          client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "creator" }),
        ]);
        loaded.push({
          address: tokenAddr,
          name: tName,
          symbol: tSymbol,
          supply: Number(formatUnits(supply, 18)).toLocaleString(),
          creator,
        });
        await new Promise(r => setTimeout(r, 50));
      }
      setAllTokens(loaded);
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
      const hash = await wc.writeContract({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "launchToken", args: [name.trim(), symbol.trim().toUpperCase()], account: address as `0x${string}` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Find the newly created token address from the latest index
      const count = await publicClient.readContract({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "allTokensLength" });
      const newTokenAddr = await publicClient.readContract({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "allTokens", args: [count - 1n] });

      setLaunchedToken({ address: newTokenAddr, name: name.trim(), symbol: symbol.trim().toUpperCase() });
      setState("idle"); setName(""); setSymbol("");
      showToast("Token launched", "success");
      await loadTokens();
      void receipt;
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to launch token."); setState("error");
    }
  }

  const isLoading = state === "processing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 460 }}>
      <div style={{ background: "rgba(79,70,229,0.05)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#a5b4fc", margin: 0 }}>
          Launch your own ERC20 token on Arc Testnet — 1,000,000 supply minted to you. Then create a liquidity pool for it under Liquidity Pools.
        </p>
      </div>

      {launchedToken && (
        <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 14, padding: "1.25rem", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚀</div>
          <p style={{ color: "#6ee7b7", fontWeight: 800, fontSize: 16, margin: "0 0 4px 0" }}>{launchedToken.name} ({launchedToken.symbol}) launched!</p>
          <p style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", margin: "0 0 12px 0", wordBreak: "break-all" }}>{launchedToken.address}</p>
          <a href={`https://testnet.arcscan.app/address/${launchedToken.address}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: "#60a5fa" }}>View on Explorer ↗</a>
        </div>
      )}

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

      <div>
        <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>RECENTLY LAUNCHED</div>
        {loadingTokens && <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>}
        {!loadingTokens && allTokens.length === 0 && <div style={{ fontSize: 12, color: "#334155" }}>No tokens launched yet. Be the first!</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {allTokens.map((t) => (
            <a key={t.address} href={`https://testnet.arcscan.app/address/${t.address}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.9rem", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
              <div>
                <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>{t.name}</span>
                <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>{t.symbol}</span>
              </div>
              <span style={{ fontSize: 11, color: "#334155" }}>{t.supply} supply</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

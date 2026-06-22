import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits } from "viem";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { arcTestnet } from "../chains";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;
const ARC_CHAIN_ID_HEX = "0x4CEF52";
const TOKENS = ["USDC", "EURC"] as const;
type Token = (typeof TOKENS)[number];
const TOKEN_ADDRESSES: Record<Token, `0x${string}`> = { USDC: USDC_ADDRESS, EURC: EURC_ADDRESS };
const kit = new AppKit();

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

interface Props { provider: EIP1193Provider; address: string; }

export default function SendForm({ provider, address }: Props) {
  const [token, setToken] = useState<Token>("USDC");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [balances, setBalances] = useState<Record<Token, string>>({ USDC: "...", EURC: "..." });
  const [sendState, setSendState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadBalances = useCallback(async () => {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const results = await Promise.all(TOKENS.map((t) => client.readContract({ address: TOKEN_ADDRESSES[t], abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).then((r) => Number(formatUnits(r, 6)).toFixed(4)).catch(() => "0.0000")));
      setBalances({ USDC: results[0], EURC: results[1] });
    } catch { /* ignore */ }
  }, [address]);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  async function doSend() {
    if (!recipient || !recipient.startsWith("0x") || recipient.length !== 42) { setErrorMsg("Enter a valid wallet address (starts with 0x, 42 chars)."); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    if (recipient.toLowerCase() === address.toLowerCase()) { setErrorMsg("Cannot send to your own address."); return; }
    setErrorMsg(null); setSendState("sending"); setTxHash(null);
    try {
      await switchToArc(provider);
      let hash: string;
      if (token === "USDC") {
        const adapter = await createViemAdapterFromProvider({ provider });
        const result = await kit.send({ from: { adapter, chain: "Arc_Testnet" }, to: recipient, amount: Number(amount).toFixed(6), token: "USDC" });
        const res = result as unknown as { txHash?: string; transactionHash?: string };
        hash = res.txHash ?? res.transactionHash ?? "";
      } else {
        const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
        hash = await wc.writeContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [recipient as `0x${string}`, parseUnits(amount, 6)], account: address as `0x${string}` });
      }
      if (!hash) throw new Error("Transaction failed.");
      setTxHash(hash); setSendState("done"); setAmount(""); setRecipient(""); await loadBalances();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Unexpected error."); setSendState("error");
    }
  }

  const isLoading = sendState === "sending";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: 460 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {TOKENS.map((t) => (
          <div key={t} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "0.6rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{t} Balance</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t === "USDC" ? "#3b82f6" : "#6366f1" }}>{balances[t]}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", backdropFilter: "blur(10px)" }}>
        <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <p style={{ fontSize: 12, color: "#6ee7b7" }}>Send tokens on Arc Testnet. Wallet will switch to Arc automatically.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Token</label>
          <div style={{ display: "flex", gap: 8 }}>
            {TOKENS.map((t) => (
              <button key={t} onClick={() => setToken(t)} disabled={isLoading}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: token === t ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.08)", background: token === t ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: token === t ? "#60a5fa" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Recipient Address</label>
          <input type="text" placeholder="0x..." value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={isLoading}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 14, color: "#f1f5f9", outline: "none", fontFamily: "monospace" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount</label>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
            <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>{token}</span>
          </div>
          <button onClick={() => setAmount(balances[token])} disabled={isLoading}
            style={{ alignSelf: "flex-end", background: "none", border: "none", color: "#60a5fa", fontSize: 12, cursor: "pointer", padding: 0 }}>
            Max ({balances[token]} {token})
          </button>
        </div>
        {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}
        {txHash && sendState === "done" && (
          <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "1rem" }}>
            <p style={{ color: "#6ee7b7", fontWeight: 600, marginBottom: 6 }}>Sent successfully!</p>
            <a href={"https://testnet.arcscan.app/tx/" + txHash} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on Explorer</a>
          </div>
        )}
        <button onClick={sendState === "error" ? () => { setSendState("idle"); setErrorMsg(null); } : doSend} disabled={isLoading || sendState === "done"}
          style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #059669, #10b981)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading || sendState === "done" ? "not-allowed" : "pointer", opacity: isLoading || sendState === "done" ? 0.6 : 1, boxShadow: "0 0 20px rgba(16,185,129,0.3)" }}>
          {sendState === "idle" && "Send"}
          {sendState === "sending" && "Sending..."}
          {sendState === "done" && "Sent!"}
          {sendState === "error" && "Try Again"}
        </button>
        {sendState === "done" && (
          <button onClick={() => { setSendState("idle"); setTxHash(null); }}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            New Transfer
          </button>
        )}
      </div>
    </div>
  );
}

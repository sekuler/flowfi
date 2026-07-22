import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;
const PERPS_CONTRACT = "0x3B4cE1734087e1c67474Ff42982063febE3E4B20" as `0x${string}`;
const FACTORY_CONTRACT = "0x7B68AbA7C610aC8Edd46846c6Aa663b86f1165d9" as `0x${string}`;

const KNOWN_TOKENS: Record<string, `0x${string}`> = {
  USDC: USDC_ADDRESS,
  EURC: EURC_ADDRESS,
  USYC: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
  ARCC: "0x215D82093892AA24b2901aeb4fcCca933346De18",
  CIRBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
};

const SWAP_ABI = [
  { type: "function", name: "swapUsdcToEurc", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }], outputs: [] },
  { type: "function", name: "swapEurcToUsdc", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }], outputs: [] },
] as const;

const PERPS_ABI = [
  { type: "function", name: "openPosition", stateMutability: "nonpayable", inputs: [{ name: "isLong", type: "bool" }, { name: "margin", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "entryPrice", type: "uint256" }, { name: "market", type: "string" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const FACTORY_ABI = [
  { type: "function", name: "createPool", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "pool", type: "address" }] },
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onRefresh: () => void;
  onNavigate: (tab: "bridge") => void;
}

interface ParsedAction {
  action: "swap" | "send" | "perp_open" | "create_pool" | "bridge" | "unknown";
  fromToken?: string;
  toToken?: string;
  amount?: number;
  useAllBalance?: boolean;
  recipient?: string;
  isLong?: boolean;
  leverage?: number;
  market?: string;
  tokenA?: string;
  tokenB?: string;
  summary: string;
  reasoning?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  action?: ParsedAction;
  confirmed?: boolean;
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

export default function AiCopilot({ provider, address, balances, onRefresh, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  async function parseCommand(text: string): Promise<ParsedAction> {
    const apiKey = (import.meta as any).env.VITE_ANTHROPIC_KEY;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: `You are FlowFi Copilot, a DeFi command parser. Parse the user's natural-language request into STRICT JSON only, no markdown, no preamble.

Schema:
{
  "action": "swap" | "send" | "perp_open" | "create_pool" | "bridge" | "unknown",
  "fromToken": "USDC" | "EURC" | "USYC" | "ARCC" | "CIRBTC" (for swap),
  "toToken": "USDC" | "EURC" | "USYC" | "ARCC" | "CIRBTC" (for swap),
  "amount": number (omit if useAllBalance is true),
  "useAllBalance": boolean (true if user says "all my X"),
  "recipient": string (address or .arc name, for send),
  "isLong": boolean (for perp_open),
  "leverage": number (for perp_open, 1-20),
  "market": "BTC" | "ETH" (for perp_open),
  "tokenA": string, "tokenB": string (for create_pool),
  "summary": "short one-line plain-English summary of what will happen",
  "reasoning": "one short sentence on any relevant risk or note"
}

Only USDC and EURC are swappable on the fixed-rate pool. If the request is ambiguous, ill-formed, or not one of the supported actions, set action to "unknown" and explain in summary.
Available user balances: USDC ${balances.usdc}, EURC ${balances.eurc}.
Respond with ONLY the JSON object.`,
        messages: [{ role: "user", content: text }],
      }),
    });
    const data = await response.json();
    const raw = data.content?.[0]?.text ?? "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    try {
      const action = await parseCommand(text);
      setMessages((prev) => [...prev, { role: "assistant", content: action.summary, action }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't understand that. Try something like \"swap 10 USDC to EURC\" or \"open a 5x BTC long with 20 USDC\"." }]);
    } finally {
      setLoading(false);
    }
  }

  async function executeAction(action: ParsedAction, msgIndex: number) {
    setExecuting(true);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

      if (action.action === "swap") {
        const amt = action.useAllBalance
          ? (action.fromToken === "USDC" ? balances.usdc : balances.eurc) ?? "0"
          : String(action.amount ?? 0);
        if (Number(amt) <= 0) throw new Error("Invalid amount.");
        const amountIn = parseUnits(amt, 6);
        const tokenAddress = action.fromToken === "USDC" ? USDC_ADDRESS : EURC_ADDRESS;

        const approveHash = await wc.writeContract({ address: tokenAddress, abi: erc20Abi, functionName: "approve", args: [SWAP_CONTRACT, amountIn], account: address as `0x${string}` });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        const hash = await wc.writeContract({
          address: SWAP_CONTRACT, abi: SWAP_ABI,
          functionName: action.fromToken === "USDC" ? "swapUsdcToEurc" : "swapEurcToUsdc",
          args: [amountIn], account: address as `0x${string}`,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        showToast("Swap completed", "success");
      } else if (action.action === "send") {
        if (!action.recipient || !action.amount) throw new Error("Missing recipient or amount.");
        const tokenAddress = action.fromToken === "EURC" ? EURC_ADDRESS : USDC_ADDRESS;
        const amountUnits = parseUnits(String(action.amount), 6);
        const hash = await wc.writeContract({ address: tokenAddress, abi: erc20Abi, functionName: "transfer", args: [action.recipient as `0x${string}`, amountUnits], account: address as `0x${string}` });
        await publicClient.waitForTransactionReceipt({ hash });
        showToast("Send completed", "success");
      } else if (action.action === "perp_open") {
        if (!action.amount || !action.leverage || !action.market) throw new Error("Missing position details.");
        const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd");
        const priceData = await priceRes.json();
        const price = action.market === "BTC" ? priceData.bitcoin?.usd : priceData.ethereum?.usd;
        if (!price) throw new Error("Could not fetch market price.");
        const marginUnits = parseUnits(String(action.amount), 6);
        const priceUnits = BigInt(Math.round(price * 1e6));

        const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [PERPS_CONTRACT, marginUnits], account: address as `0x${string}` });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        const hash = await wc.writeContract({
          address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "openPosition",
          args: [action.isLong ?? true, marginUnits, BigInt(action.leverage), priceUnits, action.market], account: address as `0x${string}`,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        showToast("Position opened", "success");
      } else if (action.action === "create_pool") {
        if (!action.tokenA || !action.tokenB) throw new Error("Missing tokens for pool.");
        const tokenA = KNOWN_TOKENS[action.tokenA.toUpperCase()];
        const tokenB = KNOWN_TOKENS[action.tokenB.toUpperCase()];
        if (!tokenA || !tokenB) throw new Error("Unknown token symbol.");
        const existing = await publicClient.readContract({ address: FACTORY_CONTRACT, abi: FACTORY_ABI, functionName: "getPool", args: [tokenA, tokenB] });
        if (existing !== "0x0000000000000000000000000000000000000000") throw new Error("Pool already exists for this pair.");
        const hash = await wc.writeContract({ address: FACTORY_CONTRACT, abi: FACTORY_ABI, functionName: "createPool", args: [tokenA, tokenB], account: address as `0x${string}` });
        await publicClient.waitForTransactionReceipt({ hash });
        showToast("Pool created", "success");
      } else if (action.action === "bridge") {
        onNavigate("bridge");
        setMessages((prev) => [...prev, { role: "assistant", content: "Bridging needs a network switch, so I've taken you to the Bridge tab — pick your source chain and confirm there." }]);
        setExecuting(false);
        return;
      }

      setMessages((prev) => prev.map((m, i) => i === msgIndex ? { ...m, confirmed: true } : m));
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMessages((prev) => [...prev, { role: "assistant", content: `Failed: ${err.message ?? "Unexpected error."}` }]);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999 }}>
      {open && (
        <div style={{ width: 360, maxHeight: 480, background: "#0d1b2f", border: "1px solid rgba(79,70,229,0.3)", borderRadius: 18, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", marginBottom: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.9rem 1.1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(79,70,229,0.15), rgba(124,58,237,0.1))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✦</div>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#f1f5f9" }}>FlowFi Copilot</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: 10, minHeight: 200, maxHeight: 320 }}>
            {messages.length === 0 && (
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                Try: "swap 10 USDC to EURC", "send 5 USDC to 0x...", "open a 5x BTC long with 20 USDC", or "create a pool for ARCC/EURC".
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
                <div style={{
                  background: m.role === "user" ? "rgba(79,70,229,0.18)" : "rgba(255,255,255,0.03)",
                  border: m.role === "user" ? "1px solid rgba(79,70,229,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10, padding: "0.6rem 0.8rem", fontSize: 13, color: m.role === "user" ? "#c7d2fe" : "#cbd5e1", lineHeight: 1.5,
                }}>
                  {m.content}
                </div>
                {m.action && m.action.action !== "unknown" && !m.confirmed && (
                  <div style={{ marginTop: 6, background: "rgba(79,70,229,0.06)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
                    {m.action.reasoning && <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 8px 0" }}>{m.action.reasoning}</p>}
                    <button onClick={() => executeAction(m.action!, i)} disabled={executing}
                      style={{ width: "100%", padding: "0.55rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: executing ? "not-allowed" : "pointer", opacity: executing ? 0.6 : 1 }}>
                      {executing ? "Executing..." : "Confirm"}
                    </button>
                  </div>
                )}
                {m.confirmed && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#6ee7b7", fontWeight: 700 }}>✓ Done</div>
                )}
              </div>
            ))}
            {loading && <div style={{ fontSize: 12, color: "#64748b" }}>Thinking...</div>}
          </div>

          <div style={{ display: "flex", gap: 8, padding: "0.9rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <input type="text" placeholder="Tell me what to do..." value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              disabled={loading}
              style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.6rem 0.8rem", fontSize: 13, color: "#f1f5f9", outline: "none" }} />
            <button onClick={handleSend} disabled={loading || !input.trim()}
              style={{ padding: "0.6rem 1rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}>
              Send
            </button>
          </div>
        </div>
      )}

      <button onClick={() => setOpen(!open)}
        style={{
          width: 58, height: 58, borderRadius: "50%", border: "none",
          background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 22, cursor: "pointer",
          boxShadow: "0 8px 24px rgba(79,70,229,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
        {open ? "✕" : "✦"}
      </button>
    </div>
  );
}
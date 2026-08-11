import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";
import { addPoints } from "../gamification";
import { computeMemoryInsight } from "../memory";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const SWAP_CONTRACT = "0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1" as `0x${string}`;
const PERPS_CONTRACT = "0x3B4cE1734087e1c67474Ff42982063febE3E4B20" as `0x${string}`;
const FACTORY_CONTRACT = "0x7B68AbA7C610aC8Edd46846c6Aa663b86f1165d9" as `0x${string}`;
const LENDING_CONTRACT = "0xD3e0171CaCd799E49155eE48981841E9a9d225ab" as `0x${string}`;

const LENDING_ABI = [
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

const TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa" as `0x${string}`;
const DOMAIN_BY_CHAIN: Record<string, number> = {
  "Ethereum Sepolia": 0,
  "Arbitrum Sepolia": 3,
  "Base Sepolia": 6,
  "Arc Testnet": 26,
};

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

function bytes32Address(addr: string): `0x${string}` {
  return `0x000000000000000000000000${addr.slice(2)}` as `0x${string}`;
}

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

interface Allocation {
  category: "lending" | "swap_to_eurc" | "idle";
  amount: number;
  percent: number;
  note: string;
}

interface ParsedAction {
  action: "swap" | "send" | "perp_open" | "create_pool" | "bridge" | "strategy" | "unknown";
  fromToken?: string;
  toToken?: string;
  amount?: number;
  useAllBalance?: boolean;
  recipient?: string;
  destinationChain?: string;
  isLong?: boolean;
  leverage?: number;
  market?: string;
  tokenA?: string;
  tokenB?: string;
  allocations?: Allocation[];
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
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://arc-testnet.g.alchemy.com/v2/alch_1L2dTNapY_mz3YEIsoVEN"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    } else throw e;
  }
}

export default function AiCopilot({ provider, address, balances, onRefresh, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [memoryText, setMemoryText] = useState<string | null>(null);

  useEffect(() => {
    if (address) computeMemoryInsight(address).then((insight) => setMemoryText(insight?.text ?? null));
  }, [address]);

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
  "action": "swap" | "send" | "perp_open" | "create_pool" | "bridge" | "strategy" | "unknown",
  "fromToken": "USDC" | "EURC" | "USYC" | "ARCC" | "CIRBTC" (for swap),
  "toToken": "USDC" | "EURC" | "USYC" | "ARCC" | "CIRBTC" (for swap),
  "amount": number (omit if useAllBalance is true),
  "useAllBalance": boolean (true if user says "all my X"),
  "recipient": string (address or .arc name, for send),
  "destinationChain": "Arc Testnet" | "Ethereum Sepolia" | "Base Sepolia" | "Arbitrum Sepolia" (ONLY for send, ONLY if the user names a specific chain the recipient should receive funds on, e.g. "send 50 USDC to 0xABC on Base" — omit entirely if no chain is mentioned, defaulting to a normal same-chain transfer on Arc),
  "isLong": boolean (for perp_open),
  "leverage": number (for perp_open, 1-20),
  "market": "BTC" | "ETH" (for perp_open),
  "tokenA": string, "tokenB": string (for create_pool),
  "allocations": [{ "category": "lending" | "swap_to_eurc" | "idle", "amount": number, "percent": number, "note": "short reason for this allocation" }] (ONLY for action "strategy"),
  "summary": "short one-line plain-English summary of what will happen",
  "reasoning": "one short sentence on any relevant risk or note"
}

Use "strategy" when the user describes a total amount and asks for a plan, allocation, or strategy (e.g. "I have 500 USDC, give me the safest strategy", "how should I split my USDC"). Allocations must sum to the user's stated amount and only use the three categories above — "lending" supplies USDC to earn yield, "swap_to_eurc" diversifies into EURC, "idle" is a deliberate cash reserve. Do not invent other categories (no LP, no perps) since those require extra parameters this schema doesn't support. A "safest" strategy should favor "lending" and "idle" over "swap_to_eurc". Explain each allocation's purpose briefly in its "note".

Only USDC and EURC are swappable on the fixed-rate pool. If the request is ambiguous, ill-formed, or not one of the supported actions, set action to "unknown" and explain in summary.

Interpret goal-oriented requests, not just literal commands. If the user states an outcome they want rather than a specific mechanism (e.g. "Get me 100 EURC on Arc", "I need 50 USDC", "top up my EURC"), figure out which single supported action gets them there and use that — you do not need the user to say the word "swap" or "bridge" explicitly. As a rule of thumb: wanting a different token they don't currently hold enough of, while already having USDC on Arc, means "swap"; wanting funds moved to a specific external address means "send" (with destinationChain if a chain is named); wanting USDC specifically on a different chain than Arc, with no recipient mentioned, means "bridge". Only fall back to "unknown" if the goal genuinely can't be reached with swap, send, bridge, perp_open, create_pool, or strategy.
Available user balances: USDC ${balances.usdc}, EURC ${balances.eurc}.
${memoryText ? `What you know about this user's real recent behavior, from their actual transaction history: ${memoryText} Use this naturally when relevant — for example, weight a "strategy" allocation toward what they already do, or mention it briefly in your reasoning if it's genuinely relevant. Never state this as a fact if it isn't directly implied by the note above, and never fabricate additional behavioral claims beyond it.` : ""}
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
        const amountUnits = parseUnits(String(action.amount), 6);

        if (action.destinationChain && action.destinationChain !== "Arc Testnet") {
          // Cross-chain send: CCTP lets the minted USDC land directly in someone
          // else's wallet on the destination chain — no manual Bridge tab needed.
          const domain = DOMAIN_BY_CHAIN[action.destinationChain];
          if (domain === undefined) throw new Error(`Unsupported destination chain: ${action.destinationChain}`);

          const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [TOKEN_MESSENGER, amountUnits], account: address as `0x${string}` });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });

          const burnHash = await wc.writeContract({
            address: TOKEN_MESSENGER, abi: DEPOSIT_FOR_BURN_ABI, functionName: "depositForBurn",
            args: [amountUnits, domain, bytes32Address(action.recipient), USDC_ADDRESS, bytes32Address("0x0000000000000000000000000000000000000000"), 500n, 1000],
            account: address as `0x${string}`,
          });
          await publicClient.waitForTransactionReceipt({ hash: burnHash });
          showToast(`USDC sent to ${action.recipient.slice(0, 6)}...${action.recipient.slice(-4)} on ${action.destinationChain} — it will arrive once Circle attests the transfer (usually 1-2 min).`, "info");
        } else {
          const tokenAddress = action.fromToken === "EURC" ? EURC_ADDRESS : USDC_ADDRESS;
          const hash = await wc.writeContract({ address: tokenAddress, abi: erc20Abi, functionName: "transfer", args: [action.recipient as `0x${string}`, amountUnits], account: address as `0x${string}` });
          await publicClient.waitForTransactionReceipt({ hash });
          showToast("Send completed", "success");
        }
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
      } else if (action.action === "strategy") {
        if (!action.allocations || action.allocations.length === 0) throw new Error("No allocation plan to execute.");
        for (const alloc of action.allocations) {
          if (alloc.category === "idle" || alloc.amount <= 0) continue;
          const amountUnits = parseUnits(String(alloc.amount), 6);

          if (alloc.category === "lending") {
            const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [LENDING_CONTRACT, amountUnits], account: address as `0x${string}` });
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
            const hash = await wc.writeContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "supply", args: [amountUnits], account: address as `0x${string}` });
            await publicClient.waitForTransactionReceipt({ hash });
          } else if (alloc.category === "swap_to_eurc") {
            const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [SWAP_CONTRACT, amountUnits], account: address as `0x${string}` });
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
            const hash = await wc.writeContract({ address: SWAP_CONTRACT, abi: SWAP_ABI, functionName: "swapUsdcToEurc", args: [amountUnits], account: address as `0x${string}` });
            await publicClient.waitForTransactionReceipt({ hash });
          }
        }
        showToast("Strategy executed", "success");
        addPoints(25);
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
    <>
      <div style={expanded
        ? { position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 999 }
        : { position: "fixed", bottom: 24, right: 24, zIndex: 999 }}>
      {open && (
        <div style={expanded
          ? { width: "min(420px, 100vw)", height: "100vh", background: "#ffffff", borderLeft: "1px solid #D4C9FA", boxShadow: "-16px 0 48px rgba(17,24,39,0.12)", display: "flex", flexDirection: "column", overflow: "hidden" }
          : { width: 360, maxHeight: 480, background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, boxShadow: "0 16px 48px rgba(109,94,247,0.2)", display: "flex", flexDirection: "column", marginBottom: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: expanded ? "1.1rem 1.4rem" : "0.9rem 1.1rem", background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: expanded ? 30 : 24, height: expanded ? 30 : 24, borderRadius: 8, background: "#6D5EF7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: expanded ? 15 : 12, color: "#fff" }}>✦</div>
              <span style={{ fontSize: expanded ? 16 : 13, fontWeight: 800, color: "#111827" }}>FlowFi Copilot</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setExpanded(!expanded)} title={expanded ? "Shrink" : "Expand"}
                style={{ background: "rgba(109,94,247,0.1)", border: "none", borderRadius: 8, color: "#6D5EF7", cursor: "pointer", fontSize: 13, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {expanded ? "⤡" : "⤢"}
              </button>
              <button onClick={() => { setOpen(false); setExpanded(false); }} style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: expanded ? "1.4rem" : "1rem", display: "flex", flexDirection: "column", gap: expanded ? 14 : 10, minHeight: expanded ? undefined : 200, maxHeight: expanded ? undefined : 320 }}>
            {messages.length === 0 && (
              <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>
                Try: "Get me 100 EURC on Arc", "I have 500 USDC, give me the safest strategy", "send 20 USDC to 0x... on Base", or "open a 5x BTC long with 20 USDC".
                {memoryText && (
                  <div style={{ marginTop: 10, background: "#f5f3ff", borderRadius: 10, padding: "0.6rem 0.75rem", color: "#5B21B6", fontSize: 11.5 }}>
                    ✦ {memoryText}
                  </div>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
                <div style={{
                  background: m.role === "user" ? "#6D5EF7" : "#f5f3ff",
                  borderRadius: 12, padding: "0.6rem 0.8rem", fontSize: 13, color: m.role === "user" ? "#ffffff" : "#374151", lineHeight: 1.5,
                }}>
                  {m.content}
                </div>
                {m.action && m.action.action !== "unknown" && !m.confirmed && (
                  <div style={{ marginTop: 6, background: "#f5f3ff", borderRadius: 12, padding: "0.7rem 0.8rem" }}>
                    {m.action.action === "strategy" && m.action.allocations && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
                        {m.action.allocations.map((a, ai) => (
                          <div key={ai} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff", borderRadius: 8, padding: "5px 8px" }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "capitalize" }}>{a.category.replace("_", " ")}</span>
                              <span style={{ fontSize: 10, color: "#6B7280", marginLeft: 6 }}>{a.note}</span>
                            </div>
                            <span className="flowfi-mono" style={{ fontSize: 11, fontWeight: 700, color: "#6D5EF7" }}>${a.amount} · {a.percent}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.action.reasoning && <p style={{ fontSize: 11, color: "#4B5563", margin: "0 0 8px 0" }}>{m.action.reasoning}</p>}
                    <button onClick={() => executeAction(m.action!, i)} disabled={executing}
                      style={{ width: "100%", padding: "0.55rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: executing ? "not-allowed" : "pointer", opacity: executing ? 0.6 : 1 }}>
                      {executing ? "Executing..." : m.action.action === "strategy" ? "Execute Strategy" : "Confirm"}
                    </button>
                  </div>
                )}
                {m.confirmed && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#16A34A", fontWeight: 700 }}>✓ Done</div>
                )}
              </div>
            ))}
            {loading && <div style={{ fontSize: 12, color: "#6B7280" }}>Thinking...</div>}
          </div>

          <div style={{ display: "flex", gap: 8, padding: expanded ? "1.2rem 1.4rem" : "0.9rem", borderTop: "1px solid #D4C9FA" }}>
            <input type="text" placeholder="Tell me what to do..." value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              disabled={loading}
              style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 12, padding: expanded ? "0.9rem 1.1rem" : "0.6rem 0.8rem", fontSize: expanded ? 15 : 13, color: "#111827", outline: "none" }} />
            <button onClick={handleSend} disabled={loading || !input.trim()}
              style={{ padding: expanded ? "0.9rem 1.4rem" : "0.6rem 1rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: expanded ? 15 : 13, fontWeight: 700, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}>
              Send
            </button>
          </div>
        </div>
      )}

      {!expanded && (
        <button onClick={() => setOpen(!open)}
          style={{
            width: 58, height: 58, borderRadius: "50%", border: "none",
            background: "#6D5EF7", color: "#fff", fontSize: 22, cursor: "pointer",
            boxShadow: "0 8px 24px rgba(109,94,247,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          {open ? "✕" : "✦"}
        </button>
      )}
      </div>
    </>
  );
}

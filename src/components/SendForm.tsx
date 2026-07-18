import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, custom, erc20Abi, parseUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const TOKENS = ["USDC", "EURC"] as const;
type Token = (typeof TOKENS)[number];
const TOKEN_ADDRESSES: Record<Token, `0x${string}`> = { USDC: USDC_ADDRESS, EURC: EURC_ADDRESS };
const ADDRESS_BOOK_KEY = "flowfi-address-book";

interface Contact {
  name: string;
  address: string;
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

function loadContacts(): Contact[] {
  try {
    return JSON.parse(localStorage.getItem(ADDRESS_BOOK_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveContacts(contacts: Contact[]) {
  localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(contacts));
}

interface Props {
  provider: EIP1193Provider;
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onRefresh: () => void;
}

interface ParsedCommand {
  amount?: string;
  token?: "USDC" | "EURC";
  recipient?: string;
}

export default function SendForm({ provider, address, balances, onRefresh }: Props) {
  const [aiCommand, setAiCommand] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFilled, setAiFilled] = useState(false);

  const [token, setToken] = useState<Token>("USDC");
  const [recipient, setRecipient] = useState("");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [showSaveContact, setShowSaveContact] = useState(false);
  const [newContactName, setNewContactName] = useState("");

  useEffect(() => { setContacts(loadContacts()); }, []);

  const currentBalance = token === "USDC" ? (balances.usdc ?? "...") : (balances.eurc ?? "...");
  const isArcName = recipient.endsWith(".arc") || recipient.endsWith(".circle");

  const resolveName = useCallback(async (name: string) => {
    setResolving(true);
    setResolveError(null);
    setResolvedAddress(null);
    try {
      const res = await fetch("https://arcname.services/api/v1/resolve/name/" + name.toLowerCase());
      const data = await res.json();
      if (data.status === "ok" && data.address) {
        setResolvedAddress(data.address);
      } else if (data.status === "not_found") {
        setResolveError("This name is not registered or has no address linked.");
      } else {
        setResolveError(data.hint ?? "Could not resolve name.");
      }
    } catch {
      setResolveError("Could not reach name service.");
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => {
    if (isArcName && recipient.length > 4) {
      const t = setTimeout(function () { resolveName(recipient); }, 500);
      return function () { clearTimeout(t); };
    } else {
      setResolvedAddress(null);
      setResolveError(null);
    }
  }, [recipient, isArcName, resolveName]);

  async function pasteAddress() {
    try {
      const text = await navigator.clipboard.readText();
      setRecipient(text.trim());
    } catch {
      setErrorMsg("Could not read clipboard. Paste manually.");
    }
  }

  function pickContact(contact: Contact) {
    setRecipient(contact.address);
    setShowAddressBook(false);
  }

  function saveCurrentContact() {
    if (!newContactName.trim() || !recipient) return;
    const addr = isArcName ? resolvedAddress : recipient;
    if (!addr || !addr.startsWith("0x")) return;
    const updated = [...contacts.filter(c => c.address.toLowerCase() !== addr.toLowerCase()), { name: newContactName.trim(), address: addr }];
    setContacts(updated);
    saveContacts(updated);
    setNewContactName("");
    setShowSaveContact(false);
  }

  function deleteContact(addr: string) {
    const updated = contacts.filter(c => c.address.toLowerCase() !== addr.toLowerCase());
    setContacts(updated);
    saveContacts(updated);
  }

  async function parseAiCommand() {
    if (!aiCommand.trim()) return;
    setAiParsing(true);
    setAiError(null);
    setAiFilled(false);
    try {
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
          max_tokens: 200,
          system: "Extract a transfer instruction from the user's message. Respond ONLY with JSON, no other text: {\"amount\":\"number as string or null\",\"token\":\"USDC or EURC or null\",\"recipient\":\"wallet address (0x...) or .arc/.circle name or null\"}. Default token to USDC if not specified but an amount and recipient are clearly present. Do not invent values not implied by the message.",
          messages: [{ role: "user", content: aiCommand }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text ?? "{}";
      const parsed: ParsedCommand = JSON.parse(text.replace(/```json|```/g, "").trim());

      if (parsed.amount) setAmount(parsed.amount);
      if (parsed.token) setToken(parsed.token);
      if (parsed.recipient) setRecipient(parsed.recipient);

      if (!parsed.amount && !parsed.recipient) {
        setAiError("Could not understand the command. Try: \"send 20 USDC to alice.arc\"");
      } else {
        setAiFilled(true);
      }
    } catch {
      setAiError("Could not process command. Please fill the form manually.");
    } finally {
      setAiParsing(false);
    }
  }

  const effectiveAddress = isArcName ? resolvedAddress : recipient;

  async function doSend() {
    if (isArcName && !resolvedAddress) {
      setErrorMsg(resolveError ?? "This name is not registered or has no address linked.");
      return;
    }
    if (!effectiveAddress || !effectiveAddress.startsWith("0x") || effectiveAddress.length !== 42) {
      setErrorMsg("Enter a valid wallet address or .arc name.");
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMsg("Enter a valid amount.");
      return;
    }
    if (effectiveAddress.toLowerCase() === address.toLowerCase()) {
      setErrorMsg("Cannot send to your own address.");
      return;
    }
    setErrorMsg(null);
    setSendState("sending");
    setTxHash(null);
    try {
      await switchToArc(provider);
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const hash = await wc.writeContract({
        address: TOKEN_ADDRESSES[token],
        abi: erc20Abi,
        functionName: "transfer",
        args: [effectiveAddress as `0x${string}`, parseUnits(amount, 6)],
        account: address as `0x${string}`,
      });
      if (!hash) throw new Error("Transaction failed.");
      setTxHash(hash);
      setSendState("done");
      setAmount("");
      setRecipient("");
      setResolvedAddress(null);
      setAiCommand("");
      setAiFilled(false);
      onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Unexpected error.");
      setSendState("error");
    }
  }

  const isLoading = sendState === "sending";
  const canSaveContact = !!effectiveAddress && effectiveAddress.startsWith("0x") && effectiveAddress.length === 42;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: 460 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(["USDC", "EURC"] as const).map((t) => (
          <div key={t} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "0.6rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{t} Balance</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t === "USDC" ? "#3b82f6" : "#6366f1" }}>
              {t === "USDC" ? (balances.usdc ?? "...") : (balances.eurc ?? "...")}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 14, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, letterSpacing: "0.5px" }}>AI TRANSFER</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. send 20 USDC to alice.arc" value={aiCommand}
            onChange={function (e) { setAiCommand(e.target.value); }}
            onKeyDown={function (e) { if (e.key === "Enter") parseAiCommand(); }}
            disabled={aiParsing || isLoading}
            style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.65rem 0.9rem", fontSize: 13, color: "#f1f5f9", outline: "none" }} />
          <button onClick={parseAiCommand} disabled={aiParsing || isLoading || !aiCommand.trim()}
            style={{ padding: "0.65rem 1.1rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #7c3aed, #8b5cf6)", color: "#fff", fontSize: 18, fontWeight: 900, cursor: aiParsing || !aiCommand.trim() ? "not-allowed" : "pointer", opacity: aiParsing || !aiCommand.trim() ? 0.6 : 1 }}>
            {aiParsing ? "..." : "➢"}
          </button>
        </div>
        {aiError && <span style={{ fontSize: 11, color: "#fca5a5" }}>{aiError}</span>}
        {aiFilled && !aiError && <span style={{ fontSize: 11, color: "#6ee7b7" }}>Form filled below — review and send.</span>}
      </div>

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", backdropFilter: "blur(10px)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Token</label>
          <div style={{ display: "flex", gap: 8 }}>
            {TOKENS.map((t) => (
              <button key={t} onClick={function () { setToken(t); }} disabled={isLoading}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: token === t ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.08)", background: token === t ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: token === t ? "#60a5fa" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Recipient Address or .arc Name</label>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={pasteAddress} disabled={isLoading}
                style={{ background: "none", border: "none", color: "#60a5fa", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Paste
              </button>
              <button onClick={function () { setShowAddressBook(!showAddressBook); }} disabled={isLoading}
                style={{ background: "none", border: "none", color: "#a78bfa", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Address Book {contacts.length > 0 ? `(${contacts.length})` : ""}
              </button>
            </div>
          </div>

          {showAddressBook && (
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.5rem", display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {contacts.length === 0 && (
                <span style={{ fontSize: 11, color: "#334155", padding: "0.5rem" }}>No saved contacts yet.</span>
              )}
              {contacts.map((c) => (
                <div key={c.address} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: 8 }}>
                  <button onClick={function () { pickContact(c); }} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace" }}>{c.address.slice(0, 8)}...{c.address.slice(-6)}</div>
                  </button>
                  <button onClick={function () { deleteContact(c.address); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, padding: "0 6px" }}>×</button>
                </div>
              ))}
            </div>
          )}

          <input type="text" placeholder="0x... or alice.arc" value={recipient} onChange={function (e) { setRecipient(e.target.value); }} disabled={isLoading}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 14, color: "#f1f5f9", outline: "none", fontFamily: "monospace" }} />
          {isArcName && resolving && (
            <span style={{ fontSize: 11, color: "#64748b" }}>Resolving name...</span>
          )}
          {isArcName && resolvedAddress && !resolving && (
            <span style={{ fontSize: 11, color: "#6ee7b7" }}>Resolves to {resolvedAddress.slice(0, 6)}...{resolvedAddress.slice(-4)}</span>
          )}
          {isArcName && resolveError && !resolving && (
            <span style={{ fontSize: 11, color: "#fca5a5" }}>{resolveError}</span>
          )}

          {canSaveContact && !showSaveContact && (
            <button onClick={function () { setShowSaveContact(true); }}
              style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#818cf8", fontSize: 11, cursor: "pointer", padding: 0 }}>
              + Save to address book
            </button>
          )}
          {showSaveContact && (
            <div style={{ display: "flex", gap: 6 }}>
              <input type="text" placeholder="Contact name" value={newContactName} onChange={function (e) { setNewContactName(e.target.value); }}
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: 12, color: "#f1f5f9", outline: "none" }} />
              <button onClick={saveCurrentContact} style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Amount</label>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={function (e) { setAmount(e.target.value); }} disabled={isLoading}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600 }} />
            <span style={{ paddingRight: "1rem", color: "#64748b", fontSize: 14, fontWeight: 600 }}>{token}</span>
          </div>
          <button onClick={function () { setAmount(currentBalance); }} disabled={isLoading}
            style={{ alignSelf: "flex-end", background: "none", border: "none", color: "#60a5fa", fontSize: 12, cursor: "pointer", padding: 0 }}>
            Max ({currentBalance} {token})
          </button>
        </div>

        {errorMsg && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>
            {errorMsg}
          </div>
        )}
        {txHash && sendState === "done" && (
          <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "1rem" }}>
            <p style={{ color: "#6ee7b7", fontWeight: 600, marginBottom: 6 }}>Sent successfully!</p>
            <a href={"https://testnet.arcscan.app/tx/" + txHash} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on Explorer</a>
          </div>
        )}
        <button onClick={sendState === "error" ? function () { setSendState("idle"); setErrorMsg(null); } : doSend}
          disabled={isLoading || sendState === "done"}
          style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #059669, #10b981)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading || sendState === "done" ? "not-allowed" : "pointer", opacity: isLoading || sendState === "done" ? 0.6 : 1, boxShadow: "0 0 20px rgba(16,185,129,0.3)" }}>
          {sendState === "idle" && "Send"}
          {sendState === "sending" && "Sending..."}
          {sendState === "done" && "Sent!"}
          {sendState === "error" && "Try Again"}
        </button>
        {sendState === "done" && (
          <button onClick={function () { setSendState("idle"); setTxHash(null); }}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            New Transfer
          </button>
        )}
      </div>
    </div>
  );
}
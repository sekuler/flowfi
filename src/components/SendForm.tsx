import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { getCircleWallet, circleContractCallAndWait, getWalletIdForChain, type CircleWalletInfo } from "../circleWalletHelpers";

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
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://arc-testnet.g.alchemy.com/v2/alch_1L2dTNapY_mz3YEIsoVEN"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
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

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);
  const [circleBalances, setCircleBalances] = useState<{ usdc: string; eurc: string } | null>(null);

  useEffect(() => { setContacts(loadContacts()); }, []);
  useEffect(() => { setCircleWallet(getCircleWallet()); }, []);

  useEffect(() => {
    if (!useCircle || !circleWallet) return;
    let cancelled = false;
    async function loadCircleBalances() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const [usdc, eurc] = await Promise.all([
          client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [circleWallet!.address as `0x${string}`] }),
          client.readContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [circleWallet!.address as `0x${string}`] }),
        ]);
        if (!cancelled) setCircleBalances({ usdc: Number(formatUnits(usdc, 6)).toFixed(2), eurc: Number(formatUnits(eurc, 6)).toFixed(2) });
      } catch {
        if (!cancelled) setCircleBalances({ usdc: "—", eurc: "—" });
      }
    }
    loadCircleBalances();
    const interval = setInterval(loadCircleBalances, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [useCircle, circleWallet]);

  const activeBalances = useCircle && circleBalances ? circleBalances : { usdc: balances.usdc ?? "...", eurc: balances.eurc ?? "..." };
  const currentBalance = token === "USDC" ? activeBalances.usdc : activeBalances.eurc;
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
    const senderAddress = useCircle && circleWallet ? circleWallet.address : address;
    if (effectiveAddress.toLowerCase() === senderAddress.toLowerCase()) {
      setErrorMsg("Cannot send to your own address.");
      return;
    }
    setErrorMsg(null);
    setSendState("sending");
    setTxHash(null);

    if (useCircle && circleWallet) {
      const arcWalletId = getWalletIdForChain(circleWallet, "ARC-TESTNET");
      if (!arcWalletId) { setErrorMsg("Circle Wallet has no Arc Testnet account."); setSendState("error"); return; }
      try {
        const hash = await circleContractCallAndWait({
          walletId: arcWalletId,
          contractAddress: TOKEN_ADDRESSES[token],
          abiFunctionSignature: "transfer(address,uint256)",
          abiParameters: [effectiveAddress, parseUnits(amount, 6).toString()],
        });
        setTxHash(hash);
        setSendState("done");
        setAmount("");
        setRecipient("");
        setResolvedAddress(null);
        setAiCommand("");
        setAiFilled(false);
      } catch (e: unknown) {
        const err = e as { message?: string };
        setErrorMsg(err.message ?? "Unexpected error.");
        setSendState("error");
      }
      return;
    }

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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", maxWidth: 460 }}>
      {circleWallet && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setUseCircle(false)} disabled={isLoading}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: !useCircle ? "#ede9fe" : "#f5f3ff", color: !useCircle ? "#a855f7" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Browser Wallet
          </button>
          <button onClick={() => setUseCircle(true)} disabled={isLoading}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: useCircle ? "#ede9fe" : "#f5f3ff", color: useCircle ? "#a855f7" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Circle Wallet
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(["USDC", "EURC"] as const).map((t) => (
          <div key={t} style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.7rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#4B5563", marginBottom: 2 }}>{t} Balance</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontFamily: "ui-monospace, monospace" }}>
              {t === "USDC" ? activeBalances.usdc : activeBalances.eurc}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "rgba(168,85,247,0.1)", borderRadius: 14, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700, letterSpacing: "0.5px" }}>AI TRANSFER</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. send 20 USDC to alice.arc" value={aiCommand}
            onChange={function (e) { setAiCommand(e.target.value); }}
            onKeyDown={function (e) { if (e.key === "Enter") parseAiCommand(); }}
            disabled={aiParsing || isLoading}
            style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.65rem 0.9rem", fontSize: 13, color: "#111827", outline: "none" }} />
          <button onClick={parseAiCommand} disabled={aiParsing || isLoading || !aiCommand.trim()}
            style={{ padding: "0.65rem 1.1rem", borderRadius: 10, border: "none", background: "#a855f7", color: "#fff", fontSize: 18, fontWeight: 900, cursor: aiParsing || !aiCommand.trim() ? "not-allowed" : "pointer", opacity: aiParsing || !aiCommand.trim() ? 0.6 : 1 }}>
            {aiParsing ? "..." : "➢"}
          </button>
        </div>
        {aiError && <span style={{ fontSize: 11, color: "#DC2626" }}>{aiError}</span>}
        {aiFilled && !aiError && <span style={{ fontSize: 11, color: "#16A34A" }}>Form filled below — review and send.</span>}
      </div>

      <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px" }}>Token</label>
          <div style={{ display: "flex", gap: 8 }}>
            {TOKENS.map((t) => (
              <button key={t} onClick={function () { setToken(t); }} disabled={isLoading}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 10, border: "none", background: token === t ? "#ede9fe" : "#f5f3ff", color: token === t ? "#a855f7" : "#4B5563", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: 11, color: "#4B5563", fontWeight: 600 }}>Recipient Address or .arc Name</label>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={pasteAddress} disabled={isLoading}
                style={{ background: "none", border: "none", color: "#a855f7", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Paste
              </button>
              <button onClick={function () { setShowAddressBook(!showAddressBook); }} disabled={isLoading}
                style={{ background: "none", border: "none", color: "#7C3AED", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Address Book {contacts.length > 0 ? `(${contacts.length})` : ""}
              </button>
            </div>
          </div>

          {showAddressBook && (
            <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "0.5rem", display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {contacts.length === 0 && (
                <span style={{ fontSize: 11, color: "#374151", padding: "0.5rem" }}>No saved contacts yet.</span>
              )}
              {contacts.map((c) => (
                <div key={c.address} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: 8 }}>
                  <button onClick={function () { pickContact(c); }} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    <div style={{ fontSize: 12, color: "#111827", fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: "#374151", fontFamily: "ui-monospace, monospace" }}>{c.address.slice(0, 8)}...{c.address.slice(-6)}</div>
                  </button>
                  <button onClick={function () { deleteContact(c.address); }} style={{ background: "none", border: "none", color: "#4B5563", cursor: "pointer", fontSize: 14, padding: "0 6px" }}>×</button>
                </div>
              ))}
            </div>
          )}

          <input type="text" placeholder="0x... or alice.arc" value={recipient} onChange={function (e) { setRecipient(e.target.value); }} disabled={isLoading}
            style={{ background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 14, color: "#111827", outline: "none", fontFamily: "ui-monospace, monospace" }} />
          {isArcName && resolving && (
            <span style={{ fontSize: 11, color: "#4B5563" }}>Resolving name...</span>
          )}
          {isArcName && resolvedAddress && !resolving && (
            <span style={{ fontSize: 11, color: "#16A34A" }}>Resolves to {resolvedAddress.slice(0, 6)}...{resolvedAddress.slice(-4)}</span>
          )}
          {isArcName && resolveError && !resolving && (
            <span style={{ fontSize: 11, color: "#DC2626" }}>{resolveError}</span>
          )}

          {canSaveContact && !showSaveContact && (
            <button onClick={function () { setShowSaveContact(true); }}
              style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#a855f7", fontSize: 11, cursor: "pointer", padding: 0 }}>
              + Save to address book
            </button>
          )}
          {showSaveContact && (
            <div style={{ display: "flex", gap: 6 }}>
              <input type="text" placeholder="Contact name" value={newContactName} onChange={function (e) { setNewContactName(e.target.value); }}
                style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: 12, color: "#111827", outline: "none" }} />
              <button onClick={saveCurrentContact} style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
            </div>
          )}
        </div>

        <div style={{ borderRadius: 16, background: "#f5f3ff", padding: "1rem 1.1rem" }}>
          <label style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px" }}>Amount</label>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={function (e) { setAmount(e.target.value); }} disabled={isLoading}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 28, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
            <span style={{ color: "#4B5563", fontSize: 14, fontWeight: 600 }}>{token}</span>
          </div>
          <button onClick={function () { setAmount(currentBalance); }} disabled={isLoading}
            style={{ marginTop: 6, background: "none", border: "none", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            Max ({currentBalance} {token})
          </button>
        </div>

        {errorMsg && (
          <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>
            {errorMsg}
          </div>
        )}
        {txHash && sendState === "done" && (
          <div style={{ background: "rgba(52,211,153,0.1)", borderRadius: 12, padding: "1rem" }}>
            <p style={{ color: "#16A34A", fontWeight: 700, marginBottom: 6 }}>Sent successfully!</p>
            <a href={"https://testnet.arcscan.app/tx/" + txHash} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>View on Explorer</a>
          </div>
        )}
        <button onClick={sendState === "error" ? function () { setSendState("idle"); setErrorMsg(null); } : doSend}
          disabled={isLoading || sendState === "done"}
          style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#34d399", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: isLoading || sendState === "done" ? "not-allowed" : "pointer", opacity: isLoading || sendState === "done" ? 0.5 : 1 }}>
          {sendState === "idle" && "Send"}
          {sendState === "sending" && "Sending..."}
          {sendState === "done" && "Sent!"}
          {sendState === "error" && "Try Again"}
        </button>
        {sendState === "done" && (
          <button onClick={function () { setSendState("idle"); setTxHash(null); }}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            New Transfer
          </button>
        )}
      </div>
    </div>
  );
}

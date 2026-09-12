// Shared helper for using a Circle Developer-Controlled Wallet to sign and send
// contract transactions (approve, swap, bridge, send, etc.) instead of a browser wallet.
// The wallet is created across multiple chains (Arc, Ethereum Sepolia, Base Sepolia,
// Arbitrum Sepolia) and shares the same address on all of them.

export type CircleChain = "ARC-TESTNET" | "ETH-SEPOLIA" | "BASE-SEPOLIA" | "ARB-SEPOLIA";

export interface CircleWalletInfo {
  address: string;
  walletsByChain: Record<string, { walletId: string; address: string }>;
  email: string;
  token: string;
}

const STORAGE_KEY = "flowfi_circle_wallet";

export function getCircleWallet(): CircleWalletInfo | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Wallets saved before the email-based login (no email/token) can't be
    // used with the backend anymore — every action now requires a session
    // tied to a verified email. Treat them as signed out rather than
    // partially working; the user re-signs-in with the same email and
    // gets the same wallet back (it's keyed by email server-side).
    if (!parsed?.email || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCircleWallet(info: CircleWalletInfo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  // Notify any already-mounted components (Swap, Bridge, etc.) that the
  // active Circle Wallet changed, so they don't keep using a stale one
  // captured on their initial mount.
  window.dispatchEvent(new Event("circle-wallet-changed"));
}

export function forgetCircleWallet() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("circle-wallet-changed"));
}

export function getWalletIdForChain(info: CircleWalletInfo | null, chain: CircleChain): string | null {
  return info?.walletsByChain?.[chain]?.walletId ?? null;
}

// ---- Email-based sign-in (replaces the old no-auth "create wallet" button) ----

export async function requestCircleWalletCode(email: string): Promise<void> {
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "requestCode", email }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "Failed to send the verification code.");
  }
}

export async function verifyCircleWalletCode(email: string, code: string): Promise<CircleWalletInfo> {
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verifyCode", email, code }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "That code didn't work — check it and try again.");
  }
  return { address: data.address, walletsByChain: data.walletsByChain, email: data.email, token: data.token };
}

interface ContractCallParams {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: (string | number)[];
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
}

interface ContractCallResult {
  transactionId: string;
  state: string;
}

export async function circleContractCall(params: ContractCallParams): Promise<ContractCallResult> {
  const wallet = getCircleWallet();
  if (!wallet) {
    throw new Error("No active Circle Wallet session — please sign in with your email again.");
  }
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "contractCall", email: wallet.email, token: wallet.token, ...params }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "Circle contract call failed.");
  }
  return { transactionId: data.transactionId, state: data.state };
}

interface TransactionStatus {
  state: string;
  txHash: string | null;
  errorReason: string | null;
}

async function getCircleTransaction(transactionId: string): Promise<TransactionStatus> {
  const wallet = getCircleWallet();
  if (!wallet) {
    throw new Error("No active Circle Wallet session — please sign in with your email again.");
  }
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "getTransaction", email: wallet.email, token: wallet.token, transactionId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "Failed to fetch transaction status.");
  }
  return { state: data.state, txHash: data.txHash ?? null, errorReason: data.errorReason ?? null };
}

// Polls a Circle transaction until it reaches a terminal state, returning the on-chain tx hash.
// State machine: INITIATED -> CLEARED -> QUEUED -> SENT -> CONFIRMED -> COMPLETE (success)
// or -> FAILED / CANCELLED / DENIED (failure).
export async function waitForCircleTransaction(transactionId: string, timeoutMs = 120000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getCircleTransaction(transactionId);
    if (status.state === "COMPLETE") {
      if (!status.txHash) throw new Error("Transaction completed but no hash was returned.");
      return status.txHash;
    }
    if (status.state === "FAILED" || status.state === "CANCELLED" || status.state === "DENIED") {
      throw new Error(status.errorReason ?? `Transaction ${status.state.toLowerCase()}.`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("Timed out waiting for the transaction to confirm.");
}

// Convenience: run a contract call and wait for it to confirm, returning the tx hash.
export async function circleContractCallAndWait(params: ContractCallParams, timeoutMs?: number): Promise<string> {
  const { transactionId } = await circleContractCall(params);
  return waitForCircleTransaction(transactionId, timeoutMs);
}

/**
 * Signs EIP-712 typed data (e.g. a Circle Gateway burn intent) with a
 * developer-controlled wallet. Unlike contractCall, this doesn't submit a
 * transaction — it returns a raw signature the caller submits elsewhere
 * (e.g. to Gateway's /v1/transfer API).
 */
export async function signTypedDataWithCircleWallet(
  walletId: string,
  data: { domain: unknown; types: unknown; primaryType: string; message: unknown }
): Promise<`0x${string}`> {
  const wallet = getCircleWallet();
  if (!wallet) {
    throw new Error("No active Circle Wallet session — please sign in with your email again.");
  }
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      { action: "signTypedData", email: wallet.email, token: wallet.token, walletId, data },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value)
    ),
  });
  const result = await res.json();
  if (!res.ok || !result.success || !result.signature) {
    throw new Error(result.error ?? "Circle typed-data signing failed.");
  }
  return result.signature as `0x${string}`;
}

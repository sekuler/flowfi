// Shared helper for using a Circle Developer-Controlled Wallet to sign and send
// contract transactions (approve, swap, bridge, send, etc.) instead of a browser wallet.
// The wallet is created across multiple chains (Arc, Ethereum Sepolia, Base Sepolia,
// Arbitrum Sepolia) and shares the same address on all of them.

export type CircleChain = "ARC-TESTNET" | "ETH-SEPOLIA" | "BASE-SEPOLIA" | "ARB-SEPOLIA";

export interface CircleWalletInfo {
  address: string;
  walletsByChain: Record<string, { walletId: string; address: string }>;
}

const STORAGE_KEY = "flowfi_circle_wallet";

export function getCircleWallet(): CircleWalletInfo | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Backward-compat: older saved wallets only had { walletId, address, blockchain }
    if (parsed && !parsed.walletsByChain && parsed.walletId) {
      return {
        address: parsed.address,
        walletsByChain: { [parsed.blockchain ?? "ARC-TESTNET"]: { walletId: parsed.walletId, address: parsed.address } },
      };
    }
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
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "contractCall", ...params }),
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
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "getTransaction", transactionId }),
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
export async function circleContractCallAndWait(params: ContractCallParams): Promise<string> {
  const { transactionId } = await circleContractCall(params);
  return waitForCircleTransaction(transactionId);
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
  const res = await fetch("/api/circle-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signTypedData", walletId, data }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  });
  const result = await res.json();
  if (!res.ok || !result.success || !result.signature) {
    throw new Error(result.error ?? "Circle typed-data signing failed.");
  }
  return result.signature as `0x${string}`;
}

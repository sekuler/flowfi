// Shared helper for using a Circle Developer-Controlled Wallet to sign and send
// contract transactions (approve, swap, bridge, etc.) instead of a browser wallet.

export interface CircleWalletInfo {
  walletId: string;
  address: string;
  blockchain: string;
}

const STORAGE_KEY = "flowfi_circle_wallet";

export function getCircleWallet(): CircleWalletInfo | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch {
    return null;
  }
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
// Circle transaction states progress roughly: INITIATED -> PENDING -> COMPLETE (success)
// or -> FAILED / CANCELLED / DENIED (failure).
export async function waitForCircleTransaction(transactionId: string, timeoutMs = 90000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getCircleTransaction(transactionId);
    if (status.state === "COMPLETE" || status.state === "CONFIRMED") {
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

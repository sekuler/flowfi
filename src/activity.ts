// Reports a finished FlowFi transaction to api/activity.js (early-user badge + FlowFi volume stats).
// Fire-and-forget: never awaited by the caller, never throws, never shown to the user.
// The server re-checks every tx onchain, so nothing here is trusted on its own.
export type ActivityKind = "cctp" | "cctpx" | "swap" | "earn" | "borrow" | "gateway" | "lifi";

export function logActivity(kind: ActivityKind, txHash: string | undefined | null, chainId?: number, address?: string | null): void {
  if (!txHash) return;
  try {
    void fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, txHash, chainId, address }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — logging must never affect the user's transaction
  }
}

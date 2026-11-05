import { useCallback, useEffect, useState } from "react";

// A transaction the wallet already sent, but whose result we couldn't read (RPC error, rate limit,
// timeout). It may still confirm, so the screen must never treat it as failed and offer to send again.
// The hash is kept across reloads, and the notice keeps checking until the chain answers.

type Hash = `0x${string}`;
type ReceiptClient = {
  waitForTransactionReceipt: (args: { hash: Hash }) => Promise<{ status: string }>;
  getTransactionReceipt: (args: { hash: Hash }) => Promise<{ status: string }>;
};

export class TxOutcomeUnknown extends Error {
  hash: Hash;
  constructor(hash: Hash) {
    super("This transaction was sent, but its result couldn't be confirmed yet.");
    this.hash = hash;
  }
}

export async function receiptOrUnknown(client: ReceiptClient, hash: Hash) {
  try {
    return await client.waitForTransactionReceipt({ hash });
  } catch {
    throw new TxOutcomeUnknown(hash);
  }
}

export function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; shortMessage?: string; message?: string };
  return err?.code === 4001 || /reject|denied|cancel/i.test(`${err?.shortMessage ?? ""} ${err?.message ?? ""}`);
}

export function useUnconfirmedTx(key: string | null) {
  const storageKey = key ? `flowfi-unconfirmed-${key.toLowerCase()}` : null;
  const [hash, setHashState] = useState<Hash | null>(null);
  useEffect(() => {
    try { setHashState(storageKey ? (localStorage.getItem(storageKey) as Hash | null) : null); } catch { setHashState(null); }
  }, [storageKey]);
  const set = useCallback((h: Hash | null) => {
    setHashState(h);
    try {
      if (!storageKey) return;
      if (h) localStorage.setItem(storageKey, h); else localStorage.removeItem(storageKey);
    } catch { /* still blocked for this visit */ }
  }, [storageKey]);
  return { hash, set };
}

export function UnconfirmedTxNotice({ client, hash, explorer, onResolved, onDismiss }: {
  client: ReceiptClient;
  hash: Hash;
  explorer: string;
  onResolved: (status: string) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (!stopped && r) { stopped = true; onResolved(r.status); }
      } catch { /* not mined yet, or the RPC failed: check again */ }
    };
    check();
    const t = setInterval(check, 6000);
    return () => { stopped = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  return (
    <div role="status" style={{ padding: "10px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, background: "#FFF8EC", color: "#92590A" }}>
      <strong>Your transaction was sent, but it isn't confirmed yet.</strong> Don't send it again. We keep checking and will update this automatically.{" "}
      <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#3D5AF1", fontWeight: 600 }}>View tx ↗</a>
      <div style={{ marginTop: 6 }}>
        <button type="button" onClick={onDismiss} style={{ padding: 0, background: "none", border: "none", color: "#92590A", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
          I checked the explorer and it never went through. Start over
        </button>
      </div>
    </div>
  );
}

import type { EIP1193Provider } from "viem";

// Reports every transaction signed through FlowFi to /api/stats, which verifies it onchain and
// adds it to FlowFi's own volume counter (see api/_lib/flowStats.js). Fire-and-forget: it never
// blocks, delays or changes a transaction, and any failure is silently ignored.

const RETRY_DELAYS_MS = [4000, 10000, 20000, 40000, 80000];

type Source = "wallet" | "lifi";

export function trackTx(hash: string, chainId: number, from: string, source: Source = "wallet") {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !Number.isInteger(chainId) || !from) return;
  let attempt = 0;
  const run = () => {
    fetch("/api/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash, chainId, from, source }),
      keepalive: true,
    })
      .then((r) => (r.ok ? r.json() : { status: "pending" }))
      .then((d: { status?: string }) => {
        if (d?.status === "pending" && attempt < RETRY_DELAYS_MS.length) setTimeout(run, RETRY_DELAYS_MS[attempt++]);
      })
      .catch(() => { if (attempt < RETRY_DELAYS_MS.length) setTimeout(run, RETRY_DELAYS_MS[attempt++]); });
  };
  setTimeout(run, RETRY_DELAYS_MS[attempt++]);
}

type Req = { method: string; params?: unknown };

// Wraps the connected wallet's provider so every eth_sendTransaction that succeeds is reported.
// Everything else (events, other methods, wallet-specific fields) passes straight through.
export function withTxTracking(provider: EIP1193Provider): EIP1193Provider {
  const target = provider as unknown as Record<string | symbol, unknown> & { request: (a: Req) => Promise<unknown> };
  if ((target as { __flowfiTracked?: boolean }).__flowfiTracked) return provider;
  // A frozen `request` can't be wrapped by a Proxy; leave such a provider untouched.
  const own = Object.getOwnPropertyDescriptor(target, "request");
  if (own && !own.configurable && !own.writable) return provider;

  const request = async (args: Req) => {
    const result = await target.request(args);
    if (args?.method === "eth_sendTransaction" && typeof result === "string") {
      // Detached so the caller gets the hash back immediately.
      void (async () => {
        try {
          const tx = (Array.isArray(args.params) ? args.params[0] : undefined) as { from?: string; chainId?: string } | undefined;
          const chainHex = tx?.chainId ?? ((await target.request({ method: "eth_chainId" })) as string);
          const from = tx?.from ?? ((await target.request({ method: "eth_accounts" })) as string[])?.[0];
          if (from) trackTx(result, Number(chainHex), from);
        } catch { /* tracking must never affect the user's transaction */ }
      })();
    }
    return result;
  };

  return new Proxy(target, {
    get(t, prop) {
      if (prop === "request") return request;
      if (prop === "__flowfiTracked") return true;
      const v = Reflect.get(t, prop, t);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as unknown as EIP1193Provider;
}

// LI.FI widget routes are signed through the widget's own wallet connection, so they are reported
// from the widget's "route completed" event instead.
type LifiRoute = { fromAddress?: string; steps?: { execution?: { actions?: { type?: string; txHash?: string; chainId?: number }[] } }[] };
export function trackLifiRoute(data: unknown) {
  const route = data as LifiRoute;
  const from = route?.fromAddress;
  if (!from || !/^0x[0-9a-fA-F]{40}$/.test(from)) return; // EVM sender only (Solana/Bitcoin skipped)
  for (const step of route.steps ?? []) {
    for (const a of step.execution?.actions ?? []) {
      if ((a.type === "SWAP" || a.type === "CROSS_CHAIN") && a.txHash && a.chainId) trackTx(a.txHash, a.chainId, from, "lifi");
    }
  }
}

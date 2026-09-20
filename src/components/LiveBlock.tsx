import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { arcMainnet } from "../chains";

// Live Arc Mainnet block number, read from the chain itself (never simulated). Renders nothing until the first
// real reading arrives, and pauses while the tab is hidden so it doesn't poll in the background.
export default function LiveBlock() {
  const [block, setBlock] = useState<bigint | null>(null);

  useEffect(() => {
    let alive = true;
    const client = createPublicClient({ chain: arcMainnet, transport: http() });
    const tick = () => {
      if (document.hidden) return;
      client.getBlockNumber().then((b) => { if (alive) setBlock(b); }).catch(() => { /* keep the last reading */ });
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (block === null) return null;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#6B7280" }}>
      <span className="flowfi-live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.18)" }} />
      <span style={{ fontWeight: 600 }}>Live on Arc</span>
      <span style={{ color: "#D1D5DB" }}>·</span>
      <span style={{ fontFamily: "ui-monospace, 'JetBrains Mono', monospace", fontVariantNumeric: "tabular-nums", color: "#374151" }}>Block {block.toLocaleString("en-US")}</span>
    </div>
  );
}

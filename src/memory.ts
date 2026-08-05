// Real pattern detection from on-chain history — no fabricated behavioral
// claims. If there isn't enough data to say something with confidence, this
// returns null rather than guessing.

const METHOD_CATEGORY: Record<string, string> = {
  "0xa9059cbb": "Send",
  "0x74b30078": "Swap",
  "0x9cd441da": "Swap",
  "0x8e0250ee": "Bridge",
  "0x57ecfd28": "Bridge",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface MemoryInsight {
  text: string;
}

export async function computeMemoryInsight(address: string): Promise<MemoryInsight | null> {
  try {
    const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=50`);
    const data = await res.json();
    const txs: any[] = data.result ?? [];
    if (txs.length < 5) return null; // not enough history to say anything meaningful

    // Most common action type.
    const categoryCounts: Record<string, number> = {};
    for (const tx of txs) {
      const category = METHOD_CATEGORY[tx.methodId] ?? null;
      if (category) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }
    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];

    // Most common weekday specifically for bridge transactions.
    const bridgeTxs = txs.filter((tx) => METHOD_CATEGORY[tx.methodId] === "Bridge");
    if (bridgeTxs.length >= 3) {
      const dayCounts: Record<number, number> = {};
      for (const tx of bridgeTxs) {
        const day = new Date(Number(tx.timeStamp) * 1000).getDay();
        dayCounts[day] = (dayCounts[day] ?? 0) + 1;
      }
      const topDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
      if (topDay && Number(topDay[1]) >= Math.ceil(bridgeTxs.length * 0.4)) {
        return { text: `You usually bridge on ${WEEKDAYS[Number(topDay[0])]}s, based on your recent activity.` };
      }
    }

    if (topCategory && topCategory[1] >= 3) {
      return { text: `${topCategory[0]} is your most common action recently (${topCategory[1]} of your last ${txs.length} transactions).` };
    }

    return null;
  } catch {
    return null;
  }
}

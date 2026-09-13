// Shared "recent trades" fetcher for any ArcPool (v4/v4b/v4c/ArcLaunchPoolFactory
// all use the identical Swap event shape). Mirrors the exact fetch strategy
// already proven out in LiquidityPools.tsx — Arcscan's indexed logs endpoint
// first (Arc Testnet's public RPC has a confirmed eth_getLogs reliability
// problem, so trying that first wastes a near-guaranteed failure on every
// load), viem's own getLogs as a fallback — but extracts the FULL event
// (trader + both amounts), not just the amountIn/aToB subset LiquidityPools.tsx
// needed for its own volume stat.
import { createPublicClient, http, parseAbiItem, decodeAbiParameters, type PublicClient } from "viem";
import { arcTestnet } from "./chains";

const SWAP_EVENT = parseAbiItem("event Swap(address indexed trader, bool aToB, uint256 amountIn, uint256 amountOut)");
const SWAP_EVENT_TOPIC0 = "0xbfd50a04f1e6e4aee344f5d0e7f15d74d0dbb58cd1f711daa6463094ca9508cd" as const; // keccak256("Swap(address,bool,uint256,uint256)")

export interface RecentTrade {
  trader: `0x${string}`;
  aToB: boolean;
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
}

async function fetchFromArcscan(poolAddress: `0x${string}`, currentBlock: bigint): Promise<RecentTrade[] | null> {
  // Arcscan's getLogs rejects a fromBlock/toBlock span wider than roughly
  // 10,000 blocks rather than silently truncating — shrinking windows
  // instead of asking for the whole chain at once.
  const windows = [9000n, 4000n, 1000n];
  for (const w of windows) {
    const fromBlock = currentBlock > w ? currentBlock - w : 0n;
    try {
      const url = `/api/arcscan-proxy?module=logs&action=getLogs&address=${poolAddress}&topic0=${SWAP_EVENT_TOPIC0}&fromBlock=${fromBlock}&toBlock=latest`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.status !== "1" && json?.message !== "OK") continue; // Blockscout signals a rejected range this way, not just a bad HTTP status
      const items: { data: `0x${string}`; topics: string[]; transactionHash: `0x${string}`; blockNumber: string }[] = json?.result ?? [];
      if (!Array.isArray(items)) continue;
      const trades: RecentTrade[] = items.map((item) => {
        const [aToB, amountIn, amountOut] = decodeAbiParameters(
          [{ type: "bool" }, { type: "uint256" }, { type: "uint256" }],
          item.data
        );
        return {
          trader: `0x${item.topics[1].slice(-40)}` as `0x${string}`, // indexed address is left-padded to 32 bytes in the topic
          aToB: aToB as boolean,
          amountIn: amountIn as bigint,
          amountOut: amountOut as bigint,
          blockNumber: BigInt(item.blockNumber),
          txHash: item.transactionHash,
        };
      });
      return trades;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchFromRpc(client: PublicClient, poolAddress: `0x${string}`, currentBlock: bigint): Promise<RecentTrade[] | null> {
  const windows = [50000n, 20000n, 5000n, 1000n, 200n];
  for (const w of windows) {
    const fromBlock = currentBlock > w ? currentBlock - w : 0n;
    try {
      const logs = await client.getLogs({ address: poolAddress, event: SWAP_EVENT, fromBlock, toBlock: "latest" });
      return logs.map((l) => ({
        trader: l.args.trader as `0x${string}`,
        aToB: l.args.aToB as boolean,
        amountIn: l.args.amountIn as bigint,
        amountOut: l.args.amountOut as bigint,
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
      }));
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchRecentTrades(poolAddress: `0x${string}`, limit = 10): Promise<RecentTrade[]> {
  try {
    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    const currentBlock = await client.getBlockNumber();
    const trades = (await fetchFromArcscan(poolAddress, currentBlock)) ?? (await fetchFromRpc(client, poolAddress, currentBlock)) ?? [];
    return trades.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1)).slice(0, limit);
  } catch {
    return []; // cosmetic feature — a failure here should never block the rest of the page
  }
}

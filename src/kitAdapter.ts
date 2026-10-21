import { createPublicClient, http } from "viem";
import type { Chain, EIP1193Provider } from "viem";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { arcMainnet } from "./chains";

// Viem adapter for Circle's kits (Bridge Kit, Unified Balance Kit) from the connected browser wallet.
// Arc's public RPC doesn't send CORS headers, so Arc reads go through FlowFi's own rpc-proxy
// (arcMainnet's default RPC); every other chain uses viem's default public RPC.
export function createKitAdapter(provider: EIP1193Provider) {
  return createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }: { chain: Chain }) =>
      createPublicClient({ chain: chain.id === arcMainnet.id ? arcMainnet : chain, transport: http() }),
  });
}

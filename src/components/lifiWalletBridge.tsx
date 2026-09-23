import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createConfig, http, WagmiProvider, useConnect, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mainnet, base, arbitrum, optimism, polygon } from "viem/chains";
import type { EIP1193Provider } from "viem";
import { arcMainnet } from "../chains";
import { flowfiConnector } from "../lifiWalletConnector";

// Lets the LI.FI widget (Bridge/Swap) see FlowFi's already-connected
// wallet instead of showing its own separate "Connect Wallet" UI and
// account box. Only wraps the widget; FlowFi's own connect/disconnect
// flow (WalletConnect.tsx, App.tsx) is completely untouched. When no
// wallet is connected yet (guest browsing), this renders children as-is
// and the widget falls back to its normal standalone behavior.
function ActivateConnector({ connectorId }: { connectorId: string }) {
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();
  const triedRef = useRef(false);

  useEffect(() => {
    if (isConnected || triedRef.current) return;
    const connector = connectors.find((c) => c.id === connectorId);
    if (connector) {
      triedRef.current = true;
      connect({ connector });
    }
  }, [isConnected, connectors, connect, connectorId]);

  return null;
}

export default function LifiWalletBridge({
  provider,
  address,
  children,
}: {
  provider?: EIP1193Provider;
  address?: string;
  children: ReactNode;
}) {
  const queryClient = useMemo(() => new QueryClient(), []);

  const config = useMemo(() => {
    if (!provider || !address) return null;
    return createConfig({
      chains: [arcMainnet, base, mainnet, arbitrum, optimism, polygon],
      connectors: [flowfiConnector(provider, address)],
      transports: {
        [arcMainnet.id]: http(),
        [base.id]: http(),
        [mainnet.id]: http(),
        [arbitrum.id]: http(),
        [optimism.id]: http(),
        [polygon.id]: http(),
      },
    });
    // Rebuilt when the connected address changes; `provider` is assumed
    // stable for a given connection, matching how App.tsx holds it in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!config) return <>{children}</>;

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config} reconnectOnMount={false}>
        <ActivateConnector connectorId="flowfi" />
        {children}
      </WagmiProvider>
    </QueryClientProvider>
  );
}

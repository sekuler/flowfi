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
    console.log("[flowfi-lifi-debug] ActivateConnector effect fired", {
      isConnected,
      tried: triedRef.current,
      connectorIds: connectors.map((c) => c.id),
    });
    if (isConnected || triedRef.current) return;
    const connector = connectors.find((c) => c.id === connectorId);
    if (!connector) {
      console.log("[flowfi-lifi-debug] connector not found in list", connectorId);
      return;
    }
    triedRef.current = true;
    connect(
      { connector },
      {
        onSuccess: (data) => console.log("[flowfi-lifi-debug] connect() succeeded", data),
        onError: (err) => console.log("[flowfi-lifi-debug] connect() FAILED", err),
      }
    );
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

  console.log("[flowfi-lifi-debug] LifiWalletBridge render", { hasProvider: !!provider, address });

  const config = useMemo(() => {
    if (!provider || !address) {
      console.log("[flowfi-lifi-debug] no provider/address -- rendering children unwrapped");
      return null;
    }
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
      {/* key={address} forces a full remount (fresh Wagmi internal state,
          fresh ActivateConnector) when the connected wallet changes --
          Wagmi's config is meant to be created once and treated as stable,
          so swapping the config object in-place on an already-mounted
          WagmiProvider doesn't reliably reset its internal connection
          state. A full remount sidesteps that entirely. */}
      <WagmiProvider key={address} config={config} reconnectOnMount={false}>
        <ActivateConnector connectorId="flowfi" />
        {children}
      </WagmiProvider>
    </QueryClientProvider>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider, createStorage, noopStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect, disconnect, getConnection } from "wagmi/actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWidgetChains, type WidgetConfig } from "@lifi/widget";
import { createDefaultWagmiConfig, useSyncWagmiConfig } from "@lifi/widget-provider-ethereum";
import type { EIP1193Provider } from "viem";

// Makes the LI.FI widget use the wallet connected to FlowFi instead of its own separate EVM
// connection. Without this the widget kept whatever wallet it last connected (e.g. another
// MetaMask account), so it could show a different address from the one in FlowFi's header.
// Solana/Bitcoin wallets stay managed by the widget itself (usePartialWalletManagement).
const CONNECTOR_ID = "flowfi-wallet";

export function useLifiWalletConfig(config: WidgetConfig, provider?: EIP1193Provider): WidgetConfig {
  return useMemo(
    () => (provider ? { ...config, walletConfig: { ...config.walletConfig, usePartialWalletManagement: true } } : config),
    [config, provider],
  );
}

export default function LifiWalletSync({ provider, address, config, children }: {
  provider?: EIP1193Provider;
  address?: string;
  config: WidgetConfig;
  children: ReactNode;
}) {
  if (!provider || !address) return <>{children}</>;
  return <Synced provider={provider} address={address} config={config}>{children}</Synced>;
}

function Synced({ provider, address, config, children }: { provider: EIP1193Provider; address: string; config: WidgetConfig; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // No persisted state and no wallet discovery: the only EVM wallet the widget sees is FlowFi's.
  const [wagmi] = useState(() =>
    createDefaultWagmiConfig({
      // `storage` isn't in the helper's type but is passed straight through to wagmi's createConfig.
      wagmiConfig: { ssr: true, multiInjectedProviderDiscovery: false, storage: createStorage({ storage: noopStorage }) } as { ssr: boolean; multiInjectedProviderDiscovery: boolean },
      lazy: true,
    }),
  );
  const connectors = useMemo(
    () => [injected({ target: () => ({ id: CONNECTOR_ID, name: "FlowFi wallet", provider: provider as never }) })],
    [provider],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ChainSync wagmiConfig={wagmi.config} connectors={connectors} widgetConfig={config} address={address}>
        <WagmiProvider config={wagmi.config} reconnectOnMount={false}>{children}</WagmiProvider>
      </ChainSync>
    </QueryClientProvider>
  );
}

function ChainSync({ wagmiConfig, connectors, widgetConfig, address, children }: {
  wagmiConfig: ReturnType<typeof createDefaultWagmiConfig>["config"];
  connectors: ReturnType<typeof injected>[];
  widgetConfig: WidgetConfig;
  address: string;
  children: ReactNode;
}) {
  const { chains } = useWidgetChains(widgetConfig);
  useSyncWagmiConfig(wagmiConfig, connectors, chains);

  // Runs after the sync above (same render, declared later), so the connector is registered.
  useEffect(() => {
    if (!chains?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const current = getConnection(wagmiConfig);
        if (current.isConnected && current.address?.toLowerCase() === address.toLowerCase()) return;
        if (current.isConnected) await disconnect(wagmiConfig);
        const connector = wagmiConfig.connectors.find((c) => c.id === CONNECTOR_ID);
        if (!connector || cancelled) return;
        await connect(wagmiConfig, { connector });
      } catch {
        // If this fails the widget simply shows its own "Connect wallet" button.
      }
    })();
    return () => { cancelled = true; };
  }, [chains, address, wagmiConfig, connectors]);

  return <>{children}</>;
}

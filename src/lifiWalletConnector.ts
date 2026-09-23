import { createConnector } from "wagmi";
import type { EIP1193Provider } from "viem";

// Wraps FlowFi's OWN already-connected wallet (whatever it is: injected
// MetaMask/Rabby, or FlowFi's own WalletConnect session from
// WalletConnect.tsx) as a wagmi connector, so the LI.FI widget -- which
// runs on wagmi internally via @lifi/widget-provider-ethereum -- sees it
// as "already connected" instead of showing its own separate Connect
// Wallet UI. Every call here just forwards to the real provider FlowFi
// already holds; FlowFi's own connect/disconnect flow (WalletConnect.tsx,
// App.tsx) is completely untouched -- this connector only exists while
// FlowFi already has a wallet connected (see the conditional wrap in
// MainnetBridge.tsx / MainnetSwap.tsx).
export function flowfiConnector(provider: EIP1193Provider, address: string) {
  return createConnector<EIP1193Provider>((config) => {
    let listenersBound = false;

    function onAccountsChanged(accounts: string[]) {
      if (accounts.length === 0) config.emitter.emit("disconnect");
      else config.emitter.emit("change", { accounts: accounts.map((a) => a as `0x${string}`) });
    }
    function onChainChanged(chain: string) {
      config.emitter.emit("change", { chainId: Number(chain) });
    }
    function onDisconnect() {
      config.emitter.emit("disconnect");
    }
    function bindListeners() {
      if (listenersBound) return;
      listenersBound = true;
      (provider as any)?.on?.("accountsChanged", onAccountsChanged);
      (provider as any)?.on?.("chainChanged", onChainChanged);
      (provider as any)?.on?.("disconnect", onDisconnect);
    }

    return {
      id: "flowfi",
      name: "FlowFi",
      type: "injected",

      async setup() {
        bindListeners();
      },

      async connect(_parameters?: { chainId?: number; isReconnecting?: boolean }) {
        bindListeners();
        const hex = (await provider.request({ method: "eth_chainId" })) as string;
        return { accounts: [address as `0x${string}`] as readonly `0x${string}`[], chainId: Number(hex) };
      },

      async disconnect() {
        // Intentionally a no-op: FlowFi's own sidebar controls the real
        // connection. Wagmi-level "disconnect" here doesn't touch the
        // actual wallet session.
      },

      async getAccounts() {
        return [address as `0x${string}`] as readonly `0x${string}`[];
      },

      async getChainId() {
        const hex = (await provider.request({ method: "eth_chainId" })) as string;
        return Number(hex);
      },

      async getProvider() {
        return provider;
      },

      async isAuthorized() {
        return true;
      },

      async switchChain({ chainId }: { chainId: number }) {
        const hexId = `0x${chainId.toString(16)}`;
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
        } catch (e: unknown) {
          const err = e as { code?: number };
          // 4902: wallet doesn't have this chain yet. Only Arc is
          // realistically missing from most wallets -- well-known
          // chains (Base, Ethereum, Arbitrum, etc.) are already present
          // in virtually every wallet, so only Arc gets a fallback here.
          if (err.code === 4902 && chainId === 5042) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: hexId,
                chainName: "Arc",
                nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
                rpcUrls: ["https://rpc.mainnet.arc.io"],
                blockExplorerUrls: ["https://arc.etherscan.io"],
              }],
            });
          } else {
            throw e;
          }
        }
        const chain = config.chains.find((c) => c.id === chainId);
        if (!chain) throw new Error(`Chain ${chainId} not configured in this widget's wagmi config.`);
        return chain;
      },

      onAccountsChanged,
      onChainChanged,
      onDisconnect,
      // The `connect()` return type above satisfies wagmi's runtime contract
      // (accounts + chainId) but not its `withCapabilities` conditional
      // generic, which this app never uses (no EIP-5792 batch calls) -- cast
      // is scoped to just this return value, not the whole file.
    } as unknown as ReturnType<Parameters<typeof createConnector<EIP1193Provider>>[0]>;
  });
}

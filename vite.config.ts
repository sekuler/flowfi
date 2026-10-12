import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

export default defineConfig({
  plugins: [react()],
  // Local development: proxy RPC calls to Arc mainnet so the app runs with `npm run dev` alone.
  // Production uses the api/rpc-proxy.js serverless function; `vite build` ignores this block.
  server: {
    proxy: {
      "/api/rpc-proxy": { target: "https://rpc.mainnet.arc.io", changeOrigin: true, rewrite: () => "/" },
      // Local only: CoinGecko prices (ticker, Home values). Production uses api/coingecko-proxy.js.
      "/api/coingecko-proxy": {
        target: "https://api.coingecko.com",
        changeOrigin: true,
        rewrite: (p) => "/api/v3" + (new URL(p, "http://localhost").searchParams.get("path") ?? ""),
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
        }),
      ],
    },
  },
});
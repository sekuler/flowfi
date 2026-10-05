import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

export default defineConfig({
  plugins: [react()],
  // Local dev only: send /api/rpc-proxy straight to Arc mainnet's RPC (vercel dev crashes on Windows here).
  // Testnet pages also hit mainnet RPC in local dev; production is unaffected (it uses api/rpc-proxy.js).
  server: {
    proxy: {
      "/api/rpc-proxy": { target: "https://rpc.mainnet.arc.io", changeOrigin: true, rewrite: () => "/" },
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
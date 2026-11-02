import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";

// Local development only: serves FlowFi's volume counter endpoints (api/track.js, api/stats.js)
// from `npm run dev`, so tracking can be tested without Vercel. Without Redis env vars the
// counter keeps its data in memory until the dev server stops. Production uses the real
// serverless functions; `vite build` ignores this plugin.
const requireCjs = createRequire(import.meta.url);
const LOCAL_API: Record<string, string> = { "/api/track": "./api/track.js", "/api/stats": "./api/stats.js" };
function localStatsApi(): Plugin {
  return {
    name: "flowfi-local-stats-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const file = LOCAL_API[url.pathname];
        if (!file) return next();
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString();
        let body: unknown;
        try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
        const vreq = Object.assign(req, { query: Object.fromEntries(url.searchParams), body });
        const vres = {
          status(code: number) { res.statusCode = code; return vres; },
          setHeader(k: string, v: string) { res.setHeader(k, v); return vres; },
          json(o: unknown) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); },
          send(t: string) { res.end(t); },
        };
        try {
          const handler = requireCjs(file) as (rq: unknown, rs: unknown) => Promise<void>;
          await handler(vreq, vres);
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
        }
      });
    },
  };
}
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

export default defineConfig({
  plugins: [react(), localStatsApi()],
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
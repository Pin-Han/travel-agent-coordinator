import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // A2A SDK v0.3.1 handles all JSON-RPC at POST /
      // Rewrite /message/send → / so the frontend can use a meaningful path
      "/message/send": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: () => "/",
        timeout: 120000,
        proxyTimeout: 120000,
      },
      // SSE streaming — no timeout, let the connection stay open
      "/message/stream": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: () => "/",
      },
    },
  },
});

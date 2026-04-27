import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 所有 /api 請求轉發到 coordinator
      "/api": "http://localhost:3000",
      // A2A 端點也代理，讓 Chat 頁面可直接打
      "/message": "http://localhost:3000",
    },
  },
});

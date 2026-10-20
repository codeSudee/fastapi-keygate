import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The UI is served by FastAPI at /keygate/dashboard, so assets resolve under that base.
export default defineConfig({
  base: "/keygate/dashboard/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/keygate/dashboard/api": "http://localhost:8000" },
  },
  build: {
    outDir: "../src/keygate/dashboard_static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});

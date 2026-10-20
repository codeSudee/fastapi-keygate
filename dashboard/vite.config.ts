import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The UI is served by FastAPI at /keygate/dashboard, so assets resolve under that base.
// `--mode demo` builds a static, mock-data copy for the marketing site at /demo/.
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
  base: demo ? "/demo/" : "/keygate/dashboard/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/keygate/dashboard/api": "http://localhost:8000" },
  },
  build: {
    outDir: demo ? "../site/public/demo" : "../src/keygate/dashboard_static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
};
});

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" }, // tes render komponen (*.test.tsx) lewat react-dom/server
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});

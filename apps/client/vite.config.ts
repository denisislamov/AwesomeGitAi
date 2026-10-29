import { defineConfig } from "vitest/config";
import { testHost } from "./e2e/host-plugin.ts";
export default defineConfig(({ mode }) => ({
  plugins: mode === "e2e" ? [testHost()] : [],
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
}));

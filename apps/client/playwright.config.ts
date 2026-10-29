import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  expect: { timeout: 5000 },
  use: { baseURL: "http://127.0.0.1:5174", headless: true },
  webServer: {
    command: "pnpm dev --mode e2e",
    url: "http://127.0.0.1:5174/test-info",
    reuseExistingServer: false,
  },
  workers: 1,
  reporter: "list",
});

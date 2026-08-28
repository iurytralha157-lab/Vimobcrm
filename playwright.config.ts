import { defineConfig, devices } from "@playwright/test";

import {
  buildE2EProcessEnv,
  requireE2ESupabaseConfig,
} from "./tests/e2e/support/e2e-env";

const discoveryOnly = process.env.E2E_DISCOVERY_ONLY === "true";
const e2eConfig = discoveryOnly
  ? {
      baseURL: "http://127.0.0.1:3100",
      apiURL: "http://127.0.0.1:8181",
    }
  : requireE2ESupabaseConfig();
const e2eProcessEnv = discoveryOnly ? {} : buildE2EProcessEnv();
const appURL = new URL(e2eConfig.baseURL);
const appPort = appURL.port || "3000";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: discoveryOnly ? undefined : "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: e2eConfig.baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
    viewport: { width: 1366, height: 768 },
  },
  webServer:
    discoveryOnly || process.env.E2E_SKIP_WEB_SERVER === "true"
      ? undefined
      : [
          {
            command: "npm run api:dev",
            url: `${e2eConfig.apiURL}/readyz`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: e2eProcessEnv,
          },
          {
            command: `npm run dev -- --hostname 127.0.0.1 --port ${appPort}`,
            url: e2eConfig.baseURL,
            reuseExistingServer: false,
            timeout: 120_000,
            env: e2eProcessEnv,
          },
        ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

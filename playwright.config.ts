import { defineConfig, devices } from '@playwright/test';

import {
  buildE2EProcessEnv,
  getE2EConfig,
  requireE2ESupabaseConfig,
} from './tests/e2e/support/e2e-env';

requireE2ESupabaseConfig();

const e2eConfig = getE2EConfig();
const e2eProcessEnv = buildE2EProcessEnv();
const appURL = new URL(e2eConfig.baseURL);
const appPort = appURL.port || '3000';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: e2eConfig.baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    viewport: { width: 1366, height: 768 },
  },
  webServer: process.env.E2E_SKIP_WEB_SERVER === 'true'
    ? undefined
    : [
        {
          command: 'npm run api:dev',
          url: `${e2eConfig.apiURL}/readyz`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: e2eProcessEnv,
        },
        {
          command: `npm run dev -- --hostname 127.0.0.1 --port ${appPort}`,
          url: e2eConfig.baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: e2eProcessEnv,
        },
      ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

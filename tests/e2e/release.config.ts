import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const directory = process.env.E2E_RELEASE_DIR ?? '';
const manifest = process.env.E2E_RELEASE_MANIFEST ?? '';
assert.ok(path.isAbsolute(directory) && path.resolve(manifest) === path.join(directory, 'target.json'),
  'Use scripts/tests/release-journey.mjs to launch a fresh owned release fixture.');
const target = JSON.parse(readFileSync(manifest, 'utf8')) as { app: string };
assert.equal(target.app, 'http://127.0.0.1:58730');

export default defineConfig({
  testDir: '.',
  testMatch: 'release-journey.case.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: path.join(directory, 'playwright'),
  use: { ...devices['Desktop Chrome'], baseURL: target.app, serviceWorkers: 'block' },
});

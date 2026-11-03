import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dataDir = mkdtempSync(path.join(tmpdir(), 'readbook-browser-'));
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));
export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://127.0.0.1:3201' },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3201/health',
    env: { APP_PASSWORD: 'browser-test-password', COOKIE_SECURE: 'false', DATA_DIR: dataDir, PORT: '3201' },
    reuseExistingServer: false,
  },
});

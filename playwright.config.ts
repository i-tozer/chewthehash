import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3006'
  },
  webServer: {
    command: 'npm run dev -- --port 3006',
    url: 'http://localhost:3006',
    reuseExistingServer: false,
    env: {
      FIXTURE_MODE: '1'
    },
    timeout: 120_000
  }
});

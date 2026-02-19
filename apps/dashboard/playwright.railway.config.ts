import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for running E2E tests against the live Railway deployment.
 * Usage: npx playwright test --config=playwright.railway.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: 'https://dashboard-production-ed96.up.railway.app',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer — Railway is already running
});

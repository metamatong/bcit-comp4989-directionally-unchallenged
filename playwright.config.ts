import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      PORT: '3100',
      HOST: '127.0.0.1',
      GEMINI_API_KEY: '',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      AI_FREE_TIER_CONFIRMED: 'false',
    },
    timeout: 30000,
  },
});

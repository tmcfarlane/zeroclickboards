import { defineConfig, devices } from '@playwright/test';

// This suite renders the real app while replacing external transports with
// disposable fixtures. It never authenticates against or writes to Supabase.
export default defineConfig({
  testDir: './tests/connector-ui',
  outputDir: './test-results/connector-ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4184',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4184 --strictPort',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: process.env.CONNECTOR_REUSE_SERVER === '1' && !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: 'https://connector-fixture.invalid',
      VITE_SUPABASE_ANON_KEY: 'disposable-fixture-public-key',
    },
  },
});

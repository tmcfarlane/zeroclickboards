import { defineConfig, devices } from '@playwright/test';

const enabled = process.env.CHATGPT_SIGN_IN_ENABLED ?? 'true';
if (enabled !== 'true' && enabled !== 'false') throw new Error('CHATGPT_SIGN_IN_ENABLED must be true or false.');

// A compiled app and the installed SDK use only disposable intercepted
// transports. This suite has no real login, global setup, or stored credentials.
export default defineConfig({
  testDir: './tests/chatgpt-auth',
  outputDir: `./test-results/chatgpt-auth/${enabled}`,
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4316',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4316 --strictPort',
    url: 'http://127.0.0.1:4316',
    reuseExistingServer: process.env.CHATGPT_AUTH_REUSE_SERVER === '1' && !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'https://chatgpt-auth-fixture.invalid',
      VITE_SUPABASE_ANON_KEY: 'disposable-chatgpt-public-key',
      VITE_CHATGPT_SIGN_IN_ENABLED: enabled,
    },
  },
});

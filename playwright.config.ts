import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './tests/e2e/env'
import { STORAGE_STATE } from './tests/e2e/global-setup'

// E2E config for the LOGGED-IN experience. global-setup mints a real Supabase
// session for the dedicated test user and writes it to STORAGE_STATE; every test
// starts authenticated. Run: `npx playwright test` (after `node scripts/e2e/ensure-test-user.mjs`).
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE, // authenticated by default
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Authenticated walkthrough specs (everything except *.public.spec.ts).
    { name: 'authenticated', testIgnore: /.*\.public\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Specs that must run signed-out (e.g. exercising the real login UI) opt out
    // of storageState by naming themselves *.public.spec.ts.
    {
      name: 'public',
      testMatch: /.*\.public\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})

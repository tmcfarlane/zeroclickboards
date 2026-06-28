import './env' // ensure E2E_EMAIL/E2E_PASSWORD are available in the worker process
import { test, expect } from '@playwright/test'

// Runs SIGNED OUT (the "public" project clears storageState) so it exercises the
// real SignInModal end-to-end — the one path the session-injection harness skips.

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test('a user can sign in through the real login form', async ({ page }) => {
  test.skip(!email || !password, 'E2E_EMAIL/E2E_PASSWORD not set')

  await page.goto('/')
  await page.getByRole('button', { name: /^(get started|sign in|log in)/i }).first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel(/email/i).fill(email!)
  await dialog.getByLabel(/password/i).fill(password!)
  await dialog.getByRole('button', { name: /^sign in$/i }).click()

  // Successful sign-in closes the modal and AuthRedirect lands us in the app.
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 })
})

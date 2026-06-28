import { test, expect } from '@playwright/test'

// These run with the authenticated storageState from global-setup, so the test
// user is already signed in. They prove the gated experience actually renders.

test('signed-in user reaching "/" is redirected into the app', async ({ page }) => {
  await page.goto('/')
  // AuthRedirect sends an authenticated user from the landing page to /app.
  await expect(page).toHaveURL(/\/app$/)
})

test('"/app" renders the authenticated shell instead of bouncing to landing', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/app$/) // requireAuth did NOT redirect us to "/"
  // The auth loading state resolves...
  await expect(page.getByText('Loading...')).toHaveCount(0)
  // ...and the public landing CTA is absent (we are not on the signed-out page).
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0)
})

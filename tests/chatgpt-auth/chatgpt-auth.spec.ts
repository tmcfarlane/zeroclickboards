import { test, expect, enabled, origin, authOrigin, storageKey, existingToken, callbackToken, userId, openSignIn, assertFitsViewport, captureEvidence } from './fixtures';

test('compiled sign-in controls match the feature flag and fit the viewport', async ({ page }, info) => {
  await page.goto('/'); const dialog = await openSignIn(page);
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  const chatgpt = dialog.getByRole('button', { name: 'Continue with ChatGPT' });
  if (enabled) {
    await expect(chatgpt).toBeVisible();
    const logo = chatgpt.locator('img'); await expect(logo).toHaveAttribute('src', '/chatgpt-logo-white.svg');
    await expect.poll(() => logo.evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  } else await expect(chatgpt).toHaveCount(0);
  await assertFitsViewport(page, dialog); await captureEvidence(page, info, 'sign-in');
});

test('the real SDK navigates ChatGPT sign-in to its fixed provider and original return URL', async ({ page, authFixture }) => {
  test.skip(!enabled, 'Disabled builds expose no native ChatGPT sign-in action.');
  const callback = `${origin}/?state=disposable-sign-in`;
  await page.goto(callback); const dialog = await openSignIn(page);
  await dialog.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect(page.getByRole('heading', { name: 'Disposable authorization destination' })).toBeVisible();
  expect(authFixture.authorizations).toHaveLength(1);
  const call = authFixture.authorizations[0]; const url = new URL(call.url);
  expect(call).toMatchObject({ method: 'GET', navigation: true });
  expect(url.origin + url.pathname).toBe(`${authOrigin}/auth/v1/authorize`);
  expect(url.searchParams.getAll('provider')).toEqual(['custom:chatgpt']);
  expect(url.searchParams.get('redirect_to')).toBe(callback);
  expect(url.searchParams.get('scopes')).toBe('openid profile');
  expect(url.searchParams.get('scopes')?.split(' ')).not.toContain('email');
  expect(authFixture.linkRequests).toEqual([]);
});

test('an unsigned denied callback shows safe cancellation text on the landing page', async ({ page }, info) => {
  const detail = 'disposable-private-provider-detail';
  await page.goto(`/?state=disposable-denial#error=access_denied&error_description=${detail}`);
  const message = page.getByText('Sign-in was cancelled. You can try again.', { exact: true });
  await expect(message).toBeVisible(); await expect(message).toHaveCount(1);
  await expect(page).toHaveURL(`${origin}/?state=disposable-denial`);
  await expect(page.getByText(detail, { exact: false })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await captureEvidence(page, info, 'denied-callback');
  await openSignIn(page); await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

test.describe('existing ZeroBoard account', () => {
  test.use({ authenticated: true });

  test('compiled account linking follows the flag and preserves account identity', async ({ page, authFixture }, info) => {
    await page.goto('/account'); await expect(page.getByText('existing-owner@example.invalid', { exact: true })).toBeVisible();
    const section = page.getByRole('region', { name: 'ChatGPT sign-in' });
    if (enabled) {
      await expect(section).toBeVisible();
      await expect(section).toContainText('keep your existing boards');
      await expect(section.getByRole('button', { name: 'Link ChatGPT account' })).toBeEnabled();
      await assertFitsViewport(page, section); await captureEvidence(page, info, 'account-link', section);
    } else {
      await expect(section).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Link ChatGPT account' })).toHaveCount(0);
      await captureEvidence(page, info, 'account-link-hidden');
    }
    expect(authFixture.linkRequests).toEqual([]);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(saved.user.id).toBe(userId); expect(saved.access_token).toBe(existingToken);
  });

  test('explicit link uses the existing bearer until the native callback completes on the same account', async ({ page, authFixture }) => {
    test.skip(!enabled, 'Disabled builds expose no identity-link action.');
    authFixture.holdLink(); const callback = `${origin}/account?state=disposable-link`;
    await page.goto(callback); await page.getByRole('button', { name: 'Link ChatGPT account' }).click();
    await expect.poll(() => authFixture.linkRequests.length).toBe(1);
    const call = authFixture.linkRequests[0]; const url = new URL(call.url);
    expect(call).toMatchObject({ method: 'GET', authorization: `Bearer ${existingToken}`, navigation: false });
    expect(url.origin + url.pathname).toBe(`${authOrigin}/auth/v1/user/identities/authorize`);
    expect(url.searchParams.get('provider')).toBe('custom:chatgpt');
    expect(url.searchParams.get('redirect_to')).toBe(callback);
    expect(url.searchParams.get('scopes')).toBe('openid profile');
    expect(url.searchParams.get('skip_http_redirect')).toBe('true');
    await expect(page).toHaveURL(callback); await expect(page.getByRole('button', { name: 'Link ChatGPT account' })).toBeDisabled();
    await expect(page.getByText('existing-owner@example.invalid', { exact: true })).toBeVisible();
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(before.user.id).toBe(userId); expect(before.access_token).toBe(existingToken);

    await authFixture.releaseLink();
    await expect(page.getByRole('heading', { name: 'Disposable authorization destination' })).toBeVisible();
    expect(authFixture.authorizations).toHaveLength(1);
    expect(new URL(authFixture.authorizations[0].url).searchParams.get('provider')).toBe('custom:chatgpt');
    // This is a disposable native Supabase callback, not an OpenAI login.
    authFixture.completeLink();
    await page.goto(`${callback}#access_token=${callbackToken}&refresh_token=disposable-callback-refresh&expires_in=3600&token_type=bearer`);
    await expect(page.getByText('ChatGPT account linked', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link ChatGPT account' })).toHaveCount(0);
    await expect(page.getByText('existing-owner@example.invalid', { exact: true })).toBeVisible();
    // Chromium may retain a bare # when the native SDK clears location.hash.
    await expect(page).toHaveURL(url => url.origin + url.pathname + url.search === callback && url.hash === '');
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(after.user.id).toBe(userId); expect(after.access_token).toBe(callbackToken);
    expect(after.user.identities.map((identity: { provider: string }) => identity.provider)).toEqual(['email', 'custom:chatgpt']);
  });

  test('a native identity collision retains the existing account and displays a safe global error', async ({ page }, info) => {
    const detail = 'disposable-private-collision-description';
    await page.goto(`/account?state=disposable-collision#error=server_error&error_code=identity_already_exists&error_description=${detail}`);
    const message = page.getByText('That account is already linked to another ZeroBoard account. Sign in to that account or choose a different ChatGPT account.', { exact: true });
    await expect(message).toBeVisible(); await expect(message).toHaveCount(1);
    await expect(page).toHaveURL(`${origin}/account?state=disposable-collision`);
    await expect(page.getByText('existing-owner@example.invalid', { exact: true })).toBeVisible();
    await expect(page.getByText(detail, { exact: false })).toHaveCount(0);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(saved.user.id).toBe(userId); expect(saved.access_token).toBe(existingToken);
    await captureEvidence(page, info, 'identity-collision');
  });

  test.describe('linked native identity', () => {
    test.use({ linked: true });
    test('renders identity-backed linked status without a link or sign-in action', async ({ page, authFixture }, info) => {
      test.skip(!enabled, 'Disabled builds hide the entire native identity section.');
      await page.goto('/account'); const section = page.getByRole('region', { name: 'ChatGPT sign-in' });
      await expect(section.getByRole('status')).toHaveText('ChatGPT account linked');
      await expect(section.getByRole('button')).toHaveCount(0);
      await assertFitsViewport(page, section); await captureEvidence(page, info, 'account-linked', section);
      expect(authFixture.linkRequests).toEqual([]);
    });
  });
});

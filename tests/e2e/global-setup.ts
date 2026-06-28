import './env' // side-effect: load .env.local into process.env (must be first)
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { BASE_URL } from './env'

// Where the authenticated storageState is written. Gitignored.
export const STORAGE_STATE = resolve(process.cwd(), 'playwright/.auth/user.json')

// supabase-js derives its localStorage key as `sb-<project-ref>-auth-token`,
// where project-ref is the first DNS label of VITE_SUPABASE_URL. Compute it the
// same way at runtime so this works across the dev project, a Supabase branch, or CI.
function storageKeyFor(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  return `sb-${ref}-auth-token`
}

/**
 * Programmatically sign the dedicated test user in (password grant against the
 * anon key) and persist the REAL, fresh session into a Playwright storageState
 * file as a localStorage entry. Tests then start already authenticated — no UI
 * typing, no Google OAuth popup. Because AuthProvider re-validates the token via
 * getUser() on boot, the session must be genuine and current; minting it here on
 * every run avoids the ~1h access-token expiry that makes captured files flaky.
 */
export default async function globalSetup() {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  if (!url || !anon || !email || !password) {
    throw new Error(
      'Missing E2E env. Need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD ' +
        '(run: node scripts/e2e/ensure-test-user.mjs).',
    )
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`E2E sign-in failed: ${error?.message ?? 'no session returned'}`)
  }

  const origin = new URL(BASE_URL).origin
  const storageState = {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [{ name: storageKeyFor(url), value: JSON.stringify(data.session) }],
      },
    ],
  }

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  writeFileSync(STORAGE_STATE, JSON.stringify(storageState, null, 2))
}

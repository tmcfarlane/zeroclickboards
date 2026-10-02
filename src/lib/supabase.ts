import { AuthSessionMissingError, createClient, navigatorLock, processLock } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { advanceAuthSessionRevision, getAuthSessionRevision } from './auth-session'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

// Match the SDK's default key so existing sessions and other tabs share the lock.
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
const authLock = typeof navigator !== 'undefined' && navigator.locks ? navigatorLock : processLock
const authLockTimeout = 10_000

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { storageKey: authStorageKey, lock: authLock },
})

// These SDK methods do not acquire its session lock. Serialize their writes with
// validation, logout and callback exchange; already-locked methods stay unwrapped.
async function runAuthMutation<T>(operation: (revision: number) => Promise<T>): Promise<T> {
  // Invalidate old checks immediately, including while this intent waits to run.
  const revision = advanceAuthSessionRevision()
  // Locked SDK methods wait for initialization first; preserve a preceding
  // logout's queue position before requesting the same lock ourselves.
  await supabase.auth.initialize()
  return authLock(`lock:${authStorageKey}`, authLockTimeout, () => operation(revision))
}

export const authSignInWithPassword = (credentials: Parameters<typeof supabase.auth.signInWithPassword>[0]) =>
  runAuthMutation(() => supabase.auth.signInWithPassword(credentials))

export const authSignUp = (credentials: Parameters<typeof supabase.auth.signUp>[0]) =>
  runAuthMutation(() => supabase.auth.signUp(credentials))

export const authSignInWithOAuth = (credentials: Parameters<typeof supabase.auth.signInWithOAuth>[0]) =>
  runAuthMutation(() => supabase.auth.signInWithOAuth(credentials))

// Like provider sign-in, the SDK's OAuth link method does not acquire its lock.
// Cancel a queued link if authentication changes before it runs, so it cannot
// accidentally attach the identity to a successor account.
export const authLinkIdentity = (credentials: Parameters<typeof supabase.auth.signInWithOAuth>[0]) =>
  runAuthMutation(async (revision) => {
    const cancelled = () => ({ data: { provider: credentials.provider, url: null }, error: new AuthSessionMissingError() })
    if (revision !== getAuthSessionRevision()) {
      return cancelled()
    }
    // Check ownership again after HTTP, before the SDK would navigate away.
    const result = await supabase.auth.linkIdentity({
      ...credentials, options: { ...credentials.options, skipBrowserRedirect: true },
    })
    if (revision !== getAuthSessionRevision()) return cancelled()
    if (!result.error && result.data.url && !credentials.options?.skipBrowserRedirect && typeof window !== 'undefined') {
      window.location.assign(result.data.url)
    }
    return result
  })

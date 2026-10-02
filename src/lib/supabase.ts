import { createClient, navigatorLock, processLock } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { advanceAuthSessionRevision } from './auth-session'

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
async function runAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  // Invalidate old checks immediately, including while this intent waits to run.
  advanceAuthSessionRevision()
  // Locked SDK methods wait for initialization first; preserve a preceding
  // logout's queue position before requesting the same lock ourselves.
  await supabase.auth.initialize()
  return authLock(`lock:${authStorageKey}`, authLockTimeout, operation)
}

export const authSignInWithPassword = (credentials: Parameters<typeof supabase.auth.signInWithPassword>[0]) =>
  runAuthMutation(() => supabase.auth.signInWithPassword(credentials))

export const authSignUp = (credentials: Parameters<typeof supabase.auth.signUp>[0]) =>
  runAuthMutation(() => supabase.auth.signUp(credentials))

export const authSignInWithOAuth = (credentials: Parameters<typeof supabase.auth.signInWithOAuth>[0]) =>
  runAuthMutation(() => supabase.auth.signInWithOAuth(credentials))

// Ensure a dedicated, CONFIRMED Supabase test user exists for E2E / agent-driven
// testing of the logged-in experience. Idempotent: safe to run repeatedly.
//
//   node scripts/e2e/ensure-test-user.mjs
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// from .env.local. Creates (or repairs) the user via the admin API with
// email_confirm:true so no inbox/confirmation step is needed, then persists
// stable E2E_EMAIL / E2E_PASSWORD back to .env.local for the Playwright harness.
//
// The service-role key is used ONLY here (Node, server-side) and never printed.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_PATH = resolve(process.cwd(), '.env.local')

function parseEnv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

function upsertEnv(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  if (re.test(text)) return text.replace(re, line)
  return text.replace(/\s*$/, '') + `\n${line}\n`
}

async function main() {
  let envText = readFileSync(ENV_PATH, 'utf8')
  const env = parseEnv(envText)

  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !serviceKey) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }

  // Stable, clearly-non-production identity (plus-addressed so it is deliverable
  // but obviously a test account). Password is generated once and reused.
  const email = env.E2E_EMAIL || 'e2e+playwright@zeroclickdev.ai'
  const password = env.E2E_PASSWORD || `Pw-${randomBytes(12).toString('base64url')}`

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  // Try to create the user already-confirmed. If it exists, find and repair it
  // (reset to our known password + ensure confirmed) so sign-in is deterministic.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) {
    const msg = created.error.message || ''
    const alreadyExists = /already.*registered|already.*exist|duplicate/i.test(msg)
    if (!alreadyExists) throw created.error

    // Page through users to find the id (small project; cap pages defensively).
    let found
    for (let page = 1; page <= 20 && !found; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
      if (data.users.length < 200) break
    }
    if (!found) throw new Error(`User ${email} reported as existing but not found via listUsers`)
    const updated = await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true })
    if (updated.error) throw updated.error
    console.log(`• Repaired existing test user (id ${found.id.slice(0, 8)}…)`)
  } else {
    console.log(`• Created test user (id ${created.data.user.id.slice(0, 8)}…)`)
  }

  // Verify the credentials actually authenticate against GoTrue (anon client,
  // password grant) — this is exactly what the Playwright global-setup does.
  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const signIn = await anonClient.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) {
    throw new Error(`Sign-in verification failed: ${signIn.error?.message ?? 'no session returned'}`)
  }
  const expSec = signIn.data.session.expires_in
  console.log(`• Sign-in verified — fresh session minted (access token valid ~${Math.round(expSec / 60)} min)`)

  // Persist creds for the harness (only if not already present/identical).
  if (env.E2E_EMAIL !== email) envText = upsertEnv(envText, 'E2E_EMAIL', email)
  if (env.E2E_PASSWORD !== password) envText = upsertEnv(envText, 'E2E_PASSWORD', password)
  writeFileSync(ENV_PATH, envText)
  console.log(`• Wrote E2E_EMAIL / E2E_PASSWORD to .env.local (${email})`)
  console.log('\n✅ Test user ready.')
}

main().catch((err) => {
  console.error('\n❌ ensure-test-user failed:', err.message)
  process.exit(1)
})

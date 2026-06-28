import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Playwright does not read .env files itself. Load .env.local into process.env
// (without overriding anything already set, e.g. CI secrets) so global-setup and
// the config can see VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD.
function loadEnvLocal() {
  let text: string
  try {
    text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  } catch {
    return // fine in CI where these come from real env vars
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[key] = v
  }
}

loadEnvLocal()

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173'

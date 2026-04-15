import { getUserFromRequest, createAuthenticatedClient, sendJson, readJsonBody, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: unknown, res: NodeRes) {
  const method = (req as { method?: string }).method
  if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return sendJson(res, 401, { error: 'Sign in required to submit feedback' })

  let payload: unknown
  try {
    payload = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' })
  }

  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const category = typeof body?.category === 'string' ? body.category : 'feature'

  if (!title || !description) {
    return sendJson(res, 400, { error: 'Title and description are required' })
  }

  const client = createAuthenticatedClient(user.token)

  // Save to database
  const { error: dbError } = await client
    .from('feedback')
    .insert({
      user_id: user.userId,
      title,
      description,
      category,
    })

  if (dbError) {
    return sendJson(res, 500, { error: 'Failed to save feedback' })
  }

  // Create GitHub issue
  const githubToken = process.env.GITHUB_TOKEN
  const repoUrl = process.env.VITE_GITHUB_REPO_URL

  if (githubToken && repoUrl) {
    try {
      // Extract owner/repo from URL like "https://github.com/owner/repo"
      const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
      if (match) {
        const [, owner, repo] = match
        const issueBody = `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n${description}\n\n---\n*Submitted via ZeroBoard feedback form*`

        await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
          },
          body: JSON.stringify({
            title,
            body: issueBody,
            labels: ['feedback', category],
          }),
        })
      }
    } catch {
      // GitHub issue creation is best-effort — don't fail the request
    }
  }

  return sendJson(res, 200, { success: true })
}

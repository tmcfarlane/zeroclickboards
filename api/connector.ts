import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { getHeader, getUserFromRequest, readJsonBody, sendJson } from './_lib/auth.js'
import { configuredConnectorRuntime, type ConnectorRuntime } from './_lib/connector-runtime.js'
import { sessionExpiry } from './_lib/connector-vault.js'
import { listBoards, requireBoardEditor } from '../mcp-server/src/board-data.js'
import { callbackKinds } from '../mcp-server/src/oauth-callback.js'

type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getUserFromRequest>>>
interface HandlerDependencies {
  runtime: () => ConnectorRuntime | null
  authenticate: typeof getUserFromRequest
}
const routes: Record<string, string> = {
  mcp: '/mcp', authorize: '/authorize', token: '/token', revoke: '/revoke',
  'authorization-metadata': '/.well-known/oauth-authorization-server',
  'resource-metadata': '/.well-known/oauth-protected-resource/mcp',
}
const requestId = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), request: requestId, boardIds: z.array(z.string().min(1).max(100)).min(1).max(100) }).strict(),
  z.object({ action: z.literal('cancel'), request: requestId }).strict(),
  z.object({ action: z.literal('revoke'), connectionId: requestId }).strict(),
])
const unavailable = { available: false, endpoint: null, connections: [], reason: 'Connections have not been configured on this deployment yet.' }

/** A single Vercel Node endpoint serves account management and the canonical OAuth/MCP rewrites. */
export function createConnectorHandler(deps: HandlerDependencies = { runtime: configuredConnectorRuntime, authenticate: getUserFromRequest }) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const url = new URL(req.url ?? '/api/connector', 'https://localhost')
    const route = url.searchParams.get('route')
    let runtime: ConnectorRuntime | null
    try { runtime = deps.runtime() } catch { runtime = null }
    if (route !== null) {
      const path = Object.hasOwn(routes, route) ? routes[route] : undefined
      if (!path) { sendJson(res, 404, { error: 'Unknown connector route' }); return }
      if (!runtime) { sendJson(res, 503, { error: 'Hosted connector unavailable' }); return }
      try { await runtime.health() } catch { sendJson(res, 503, { error: 'Hosted connector unavailable' }); return }
      // Vercel may already parse JSON/form bodies; Express consumes req.body without
      // re-reading a completed stream. Original OAuth parameters are retained.
      url.searchParams.delete('route')
      req.url = path + (url.search ? url.search : '')
      await new Promise<void>((resolve, reject) => {
        res.once('finish', resolve)
        res.once('close', resolve)
        runtime.app(req as Request, res as Response, (error?: unknown) => error ? reject(error) : resolve())
      }).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'Connector request failed' }) })
      return
    }
    if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); sendJson(res, 405, { error: 'Method not allowed' }); return }
    const user = await deps.authenticate(req)
    if (!user) { sendJson(res, 401, { error: 'Sign in to manage ChatGPT connections' }); return }
    if (!runtime) {
      sendJson(res, req.method === 'GET' && !url.searchParams.has('action') ? 200 : 503, unavailable)
      return
    }
    const action = url.searchParams.get('action')
    try { await runtime.health() } catch {
      sendJson(res, req.method === 'GET' && !action ? 200 : 503, { ...unavailable, reason: 'The hosted connection is temporarily unavailable. Try again later.' })
      return
    }
    try {
      if (req.method === 'GET') {
        if (action === 'consent') {
          const request = requestId.parse(url.searchParams.get('request'))
          const pending = await runtime.oauth.consentRequest(request)
          const client = await runtime.oauth.clientsStore.getClient(pending.clientId)
          if (!client) throw new Error('Consent request unavailable')
          const boards = await listSelectableBoards(runtime, user)
          sendJson(res, 200, { clientName: client.client_name ?? client.client_id, scopes: pending.scopes,
            expiresAt: new Date(pending.expires).toISOString(), boards })
          return
        }
        if (action !== null) { sendJson(res, 400, { error: 'Unknown connector action' }); return }
        const connections = (await runtime.listConnections(user.userId)).map(grant => ({ id: grant.id,
          clientName: runtime.config.clients.find(client => client.client_id === grant.clientId)?.client_name ?? grant.clientId,
          boardIds: grant.boardIds, scopes: grant.scopes, expiresAt: new Date(grant.expires).toISOString() }))
        sendJson(res, 200, { available: true, endpoint: runtime.config.resource.href, connections,
          clients: runtime.config.clients.map(client => ({ name: client.client_name ?? client.client_id, clientId: client.client_id,
            callbackKinds: callbackKinds(client.redirect_uris) })) })
        return
      }
      // A bearer token is never read from cookies or query strings. Same-origin
      // Origin additionally protects approvals/revocations from cross-site requests.
      const origin = getHeader(req, 'origin')
      if (origin !== runtime.config.issuer.origin) { sendJson(res, 403, { error: 'Open this action in ZeroBoard' }); return }
      const input = actionSchema.parse(await readJsonBody(req))
      if (input.action === 'cancel') {
        const redirectUrl = await runtime.oauth.cancelConsent(input.request)
        sendJson(res, 200, { cancelled: true, redirectUrl })
      } else if (input.action === 'revoke') {
        const grant = await runtime.oauth.options.store.get('grant', input.connectionId)
        if (!grant || grant.userId !== user.userId) { sendJson(res, 404, { error: 'Connection unavailable' }); return }
        await runtime.oauth.revokeConnection(input.connectionId, user.userId)
        await runtime.vault.remove(grant.accountRef)
        sendJson(res, 200, { success: true })
      } else {
        // Validate the pending request before storing an encrypted account token.
        await runtime.oauth.consentRequest(input.request)
        const accountRef = await runtime.vault.save({ accessToken: user.token, userId: user.userId, expires: sessionExpiry(user.token) })
        try {
          const redirectUrl = await runtime.oauth.approveConsent(input.request, accountRef, input.boardIds)
          sendJson(res, 200, { redirectUrl })
        } catch (error) {
          await runtime.vault.remove(accountRef)
          throw error
        }
      }
    } catch {
      sendJson(res, 400, { error: 'The connection request could not be completed. Check your board access and try connecting again.' })
    }
  }
}

async function listSelectableBoards(runtime: ConnectorRuntime, user: AuthenticatedUser) {
  const client = runtime.accountClient(user.token, user.userId)
  const boards = await listBoards(client)
  return Promise.all(boards.map(async board => {
    let canAddCards = true
    try { await requireBoardEditor(client, board.id) } catch { canAddCards = false }
    return { id: board.id, name: board.name, canAddCards }
  }))
}

export default createConnectorHandler()

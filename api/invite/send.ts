import { getUserFromRequest, createServiceClient, jsonResponse } from '../_lib/auth'
import { Resend } from 'resend'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return jsonResponse(401, { error: 'Sign in required' })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const boardId = typeof body?.boardId === 'string' ? body.boardId : ''
  const boardName = typeof body?.boardName === 'string' ? body.boardName : ''
  const role = typeof body?.role === 'string' ? body.role : 'viewer'

  if (!email || !boardId) {
    return jsonResponse(400, { error: 'Email and boardId are required' })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return jsonResponse(500, { error: 'Email service not configured — set RESEND_API_KEY' })
  }

  let inviterName = user.email || 'Someone'
  let supabase: ReturnType<typeof createServiceClient> | null = null

  try {
    supabase = createServiceClient()
  } catch {
    // Service role key not set — continue without DB lookups
  }

  // Look up inviter's display name
  if (supabase) {
    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.userId)
      .single()
    if (inviterProfile?.full_name) inviterName = inviterProfile.full_name
    else if (inviterProfile?.email) inviterName = inviterProfile.email

    // If invitee already has an account, add them as a board member
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (existingProfile) {
      await supabase
        .from('board_members')
        .upsert(
          { board_id: boardId, user_id: existingProfile.id, role, invited_by: user.userId },
          { onConflict: 'board_id,user_id' }
        )
    }
  }

  const boardUrl = `${req.headers.get('origin') || 'https://zeroclickboards.com'}/board/${boardId}`

  try {
    const resend = new Resend(resendKey)

    const { data, error: sendError } = await resend.emails.send({
      from: 'ZeroClickBoards <no-reply@zeroclickdev.ai>',
      to: email,
      subject: `${inviterName} invited you to "${boardName}" on ZeroClickBoards`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
          <h2 style="color: #111; margin-bottom: 8px;">You've been invited!</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.5;">
            <strong>${inviterName}</strong> invited you to collaborate on
            <strong>"${boardName}"</strong> as a <strong>${role}</strong>.
          </p>
          <a href="${boardUrl}" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #78fcd6; color: #111; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Open Board
          </a>
          <p style="color: #999; font-size: 13px; margin-top: 24px;">
            If you don't have an account yet, you'll be prompted to sign up when you open the link.
          </p>
        </div>
      `,
    })

    if (sendError) {
      console.error('[invite/send] Resend error:', JSON.stringify(sendError))
      return jsonResponse(500, { error: sendError.message || 'Failed to send invitation email' })
    }

    return jsonResponse(200, { success: true, emailId: data?.id })
  } catch (err: any) {
    console.error('[invite/send] Unexpected error:', err)
    return jsonResponse(500, { error: err.message || 'Unexpected error sending email' })
  }
}

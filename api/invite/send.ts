import {
  getUserFromRequest,
  createServiceClient,
  sendJson,
  readJsonBody,
  type NodeRes,
} from "../_lib/auth.js";
import { Resend } from "resend";

export const config = { runtime: "nodejs", maxDuration: 15 };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const VALID_ROLES = ["viewer", "commenter", "editor"] as const;

export default async function handler(req: unknown, res: NodeRes) {
  const method = (req as { method?: string }).method;
  if (method !== "POST")
    return sendJson(res, 405, { error: "Method not allowed" });

  const user = await getUserFromRequest(req);
  if (!user) return sendJson(res, 401, { error: "Sign in required" });

  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const boardId = typeof body?.boardId === "string" ? body.boardId : "";
  const role = typeof body?.role === "string" ? body.role : "viewer";

  if (!email || !boardId) {
    return sendJson(res, 400, { error: "Email and boardId are required" });
  }

  if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    return sendJson(res, 400, {
      error: "Invalid role. Must be viewer, commenter, or editor.",
    });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return sendJson(res, 500, {
      error: "Email service not configured — set RESEND_API_KEY",
    });
  }

  let boardUrl: string;
  try {
    const origin = new URL(
      process.env.ZEROBOARD_CONNECTOR_ISSUER || "https://board.zeroclickdev.ai",
    );
    if (origin.protocol !== "https:" || origin.href !== `${origin.origin}/`) {
      throw new Error("Invalid application origin");
    }
    boardUrl = new URL(`/board/${encodeURIComponent(boardId)}`, origin).href;
  } catch {
    return sendJson(res, 503, { error: "Sharing service is unavailable" });
  }

  let inviterName = user.email || "Someone";
  let supabase: ReturnType<typeof createServiceClient>;

  try {
    supabase = createServiceClient();
  } catch {
    return sendJson(res, 503, { error: "Sharing service is unavailable" });
  }
  if (!supabase)
    return sendJson(res, 503, { error: "Sharing service is unavailable" });

  // Verify the caller owns this board
  let boardName = "";
  let accessSaved = false;
  const saveFailure = () => sendJson(res, 503, {
    error: "Failed to save invitation",
    ...(accessSaved ? { accessSaved: true } : {}),
  });
  try {
    const { data: board, error: boardError } = await supabase
      .from("boards")
      .select("user_id, name")
      .eq("id", boardId)
      .single();

    if (boardError || !board || board.user_id !== user.userId) {
      return sendJson(res, 403, {
        error: "You do not have permission to share this board",
      });
    }
    boardName = board.name;

    // Look up inviter's display name
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.userId)
      .single();
    if (inviterProfile?.full_name) inviterName = inviterProfile.full_name;
    else if (inviterProfile?.email) inviterName = inviterProfile.email;

    // Always store a pending invite (works for any email)
    const { data: savedInvite, error: inviteError } = await supabase
      .from("board_invites")
      .upsert(
        {
          board_id: boardId,
          email,
          role,
          invited_by: user.userId,
          board_name: boardName,
        },
        { onConflict: "board_id,email" },
      )
      .select("board_id, email, role, invited_by")
      .single();
    if (
      inviteError ||
      !savedInvite ||
      savedInvite.board_id !== boardId ||
      savedInvite.email !== email ||
      savedInvite.role !== role ||
      savedInvite.invited_by !== user.userId
    ) {
      return saveFailure();
    }
    accessSaved = true;

    // If invitee already has an account, also add them as a member immediately
    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (profileError) {
      return saveFailure();
    }

    if (existingProfile) {
      if (typeof existingProfile.id !== "string" || !existingProfile.id) {
        return saveFailure();
      }
      const { data: savedMember, error: memberError } = await supabase
        .from("board_members")
        .upsert(
          {
            board_id: boardId,
            user_id: existingProfile.id,
            role,
            invited_by: user.userId,
          },
          { onConflict: "board_id,user_id" },
        )
        .select("board_id, user_id, role, invited_by")
        .single();
      if (
        memberError ||
        !savedMember ||
        savedMember.board_id !== boardId ||
        savedMember.user_id !== existingProfile.id ||
        savedMember.role !== role ||
        savedMember.invited_by !== user.userId
      ) {
        return saveFailure();
      }
      // Clean up the invite since they're already a member
      const { error: cleanupError } = await supabase
        .from("board_invites")
        .delete()
        .eq("board_id", boardId)
        .eq("email", email);
      if (cleanupError) {
        return saveFailure();
      }
    }
  } catch {
    return saveFailure();
  }

  const safeBoardUrl = escapeHtml(boardUrl);
  const safeName = escapeHtml(inviterName);
  const safeBoardName = escapeHtml(boardName);
  const safeRole = escapeHtml(role);

  try {
    const resend = new Resend(resendKey);

    const { data, error: sendError } = await resend.emails.send({
      from: "ZeroClickBoards <no-reply@zeroclickdev.ai>",
      to: email,
      subject: `${inviterName} invited you to "${boardName}" on ZeroClickBoards`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
          <h2 style="color: #111; margin-bottom: 8px;">You've been invited!</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.5;">
            <strong>${safeName}</strong> invited you to collaborate on
            <strong>"${safeBoardName}"</strong> as a <strong>${safeRole}</strong>.
          </p>
          <a href="${safeBoardUrl}" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #78fcd6; color: #111; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Open Board
          </a>
          <p style="color: #999; font-size: 13px; margin-top: 24px;">
            If you don't have an account yet, you'll be prompted to sign up when you open the link.
          </p>
        </div>
      `,
    });

    if (sendError) {
      console.error("[invite/send] Resend error:", JSON.stringify(sendError));
      return sendJson(res, 500, {
        error: sendError.message || "Failed to send invitation email",
        ...(accessSaved ? { accessSaved: true } : {}),
      });
    }

    return sendJson(res, 200, { success: true, emailId: data?.id });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unexpected error sending email";
    console.error("[invite/send] Unexpected error:", err);
    return sendJson(res, 500, {
      error: message,
      ...(accessSaved ? { accessSaved: true } : {}),
    });
  }
}

-- SECURITY DEFINER helpers must not be inherited by every database login.
-- Browser clients use the auth-bound wrapper; signup runs the raw resolver
-- inside the existing postgres-owned trigger. Keep the trusted service path.
revoke execute on function public.resolve_pending_invites(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_pending_invites(uuid, text) to service_role;

-- A direct SQL login can set request.jwt.claim.sub itself. Only the role used
-- behind authenticated JWT validation may call this browser RPC.
revoke execute on function public.resolve_pending_invites_for_current_user() from public, anon, service_role;
grant execute on function public.resolve_pending_invites_for_current_user() to authenticated;

-- Ordinary logins can create temporary tables and attach executable trigger
-- functions to them. Existing triggers do not need caller EXECUTE at runtime.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated, service_role;
revoke execute on function public.sync_user_email() from public, anon, authenticated, service_role;

-- RLS still needs the explicit browser/service grants. Unrelated SQL logins
-- should not enumerate board membership through PUBLIC execution.
revoke execute on function public.get_board_ids_for_user(uuid) from public;
revoke execute on function public.get_editable_board_ids_for_user(uuid) from public;

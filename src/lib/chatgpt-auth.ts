import type { SignInWithOAuthCredentials } from '@supabase/supabase-js';

export const CHATGPT_AUTH_PROVIDER = 'custom:chatgpt';

// Enable only after the approved OpenAI client and Supabase OIDC provider work.
export const isChatGPTSignInEnabled = () => import.meta.env.VITE_CHATGPT_SIGN_IN_ENABLED === 'true';

export function getChatGPTAuthRedirectUrl(href: string): string {
  const url = new URL(href);
  const authFields = [
    'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
    'token_type', 'expires_in', 'expires_at', 'error', 'error_code', 'error_description',
  ];
  for (const field of authFields) url.searchParams.delete(field);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (authFields.some((field) => fragment.has(field))) url.hash = '';
  // Keep the original route, connector state, CLI challenge and anchor.
  return url.toString();
}

export function chatGPTProviderCredentials(redirectTo: string): SignInWithOAuthCredentials {
  return {
    // The installed SDK forwards custom providers but predates their TS union.
    // Keep this compatibility cast confined to a fixed, server-configured ID.
    provider: CHATGPT_AUTH_PROVIDER as SignInWithOAuthCredentials['provider'],
    // Existing accounts must link explicitly; do not request email for native
    // automatic matching. The provider also requires email_optional=true and
    // matching scopes, with email omission verified before enablement.
    options: { redirectTo: getChatGPTAuthRedirectUrl(redirectTo), scopes: 'openid profile' },
  };
}

export function getOAuthCallbackErrorMessage(error: { code?: string; details?: { code?: string; error?: string } }): string {
  const codes = [error.code, error.details?.code, error.details?.error];
  if (codes.includes('identity_already_exists')) {
    return 'That account is already linked to another ZeroBoard account. Sign in to that account or choose a different ChatGPT account.';
  }
  if (codes.includes('access_denied')) return 'Sign-in was cancelled. You can try again.';
  return 'Could not complete sign-in. Please try again or use another sign-in method.';
}

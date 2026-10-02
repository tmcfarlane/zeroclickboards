import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { SignInModal } from '@/components/auth/SignInModal';
import { Button } from '@/components/ui/button';
import { connectorRequest, permissionLabel } from '@/components/connectors/connector-api';
import type { ConnectorConsent } from '@/components/connectors/connector-api';
import { isOAuthCallbackUri } from '../../mcp-server/src/oauth-callback';

export function ConnectorConsentPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const request = params.get('request');
  return <ConnectorConsentRequest key={JSON.stringify([user?.id ?? null, request])} request={request} />;
}

function ConnectorConsentRequest({ request }: { request: string | null }) {
  const { session, user, isSignedIn, isLoaded } = useAuthContext();
  const [consent, setConsent] = useState<ConnectorConsent | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'cancel' | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [cancelRedirect, setCancelRedirect] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const pending = useRef<symbol | null>(null);
  const read = useRef<AbortController | null>(null);
  const loadedRefresh = useRef<number | null>(null);

  useLayoutEffect(() => {
    const lifetime = epoch;
    ++lifetime.current;
    return () => {
      ++lifetime.current;
      pending.current = null;
      read.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !session || !request || loadedRefresh.current === refresh) return;
    const controller = new AbortController();
    const lifetime = epoch.current;
    read.current = controller;
    setConsent(null);
    setSelected([]);
    setError(null);
    connectorRequest<ConnectorConsent>(session, { query: new URLSearchParams({ action: 'consent', request }), signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted && epoch.current === lifetime && read.current === controller) {
          loadedRefresh.current = refresh;
          setConsent(data);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && epoch.current === lifetime && read.current === controller) setError(cause instanceof Error ? cause.message : 'Unable to load the connection request.');
      });
    return () => controller.abort();
  }, [isLoaded, session, request, refresh]);

  const unknownScopes = consent?.scopes.some((scope) => !permissionLabel(scope)) ?? false;
  const needsEditor = consent?.scopes.includes('cards:add') ?? false;
  const eligibleBoards = consent?.boards.filter((board) => !needsEditor || board.canAddCards) ?? [];
  const canApprove = !!consent && !unknownScopes && selected.length > 0 && !busy;

  const approve = async () => {
    if (!session || !request || !canApprove || pending.current) return;
    const attempt = Symbol();
    const lifetime = epoch.current;
    pending.current = attempt;
    const current = () => epoch.current === lifetime && pending.current === attempt;
    setBusy('approve');
    setError(null);
    try {
      const data = await connectorRequest<{ redirectUrl: string }>(session, { body: { action: 'approve', request, boardIds: selected } });
      if (!current()) return;
      if (!isOAuthCallbackUri(data.redirectUrl)) {
        throw new Error('The connection returned an invalid return address. Restart setup in your client.');
      }
      window.location.assign(new URL(data.redirectUrl).href);
    } catch (cause) {
      if (current()) {
        pending.current = null;
        setError(cause instanceof Error ? cause.message : 'Unable to allow the connection. Please try again.');
        setBusy(null);
      }
    }
  };

  const cancel = async () => {
    if (!session || !request || pending.current) return;
    const attempt = Symbol();
    const lifetime = epoch.current;
    pending.current = attempt;
    const current = () => epoch.current === lifetime && pending.current === attempt;
    setBusy('cancel');
    setError(null);
    try {
      const result = await connectorRequest<{ cancelled: true; redirectUrl?: string }>(session, { body: { action: 'cancel', request } });
      if (!current()) return;
      if (isOAuthCallbackUri(result.redirectUrl)) setCancelRedirect(new URL(result.redirectUrl).href);
      setCancelled(true);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'Unable to cancel. Please try again.');
    } finally {
      if (current()) {
        pending.current = null;
        setBusy(null);
      }
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <Link to="/app" className="inline-flex items-center gap-2 text-sm text-[#A8B2B2] hover:text-[#F2F7F7] mb-7"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to boards</Link>
        <section className="rounded-2xl border border-white/10 bg-[#111515] p-6 sm:p-8" aria-labelledby="consent-heading">
          <div className="flex items-center gap-3 mb-6">
            <img src="/logo/logo_color.svg" alt="" className="h-9 w-9" />
            <span className="font-semibold">ZeroBoard</span>
            <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
            <Link2 className="h-5 w-5 text-[#78fcd6]" aria-hidden="true" />
          </div>

          {!request ? (
            <>
              <h1 id="consent-heading" className="text-xl font-semibold">Start in ChatGPT or Codex</h1>
              <p className="mt-3 text-sm text-[#A8B2B2]">This page opens when a client requests access to your boards. Add ZeroBoard in your client to begin.</p>
              <Link to="/account#connectors" className="inline-flex mt-5 text-sm text-[#78fcd6] hover:underline">View connection setup</Link>
            </>
          ) : !isLoaded ? (
            <p role="status" className="flex items-center gap-2 text-sm text-[#A8B2B2]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading your account…</p>
          ) : !isSignedIn || !session ? (
            <>
              <h1 id="consent-heading" className="text-xl font-semibold">Connect your ZeroBoard account</h1>
              <p className="mt-3 text-sm text-[#A8B2B2]">Sign in to review the requesting client, choose your boards, and approve access.</p>
              <p className="mt-2 text-xs text-[#A8B2B2]">If your session has expired, sign in again to continue this request.</p>
              <Button onClick={() => setSignInOpen(true)} className="mt-6 w-full bg-[#78fcd6] text-[#0B0F0F] hover:bg-[#78fcd6]/90">Sign in to continue</Button>
              <p className="mt-4 text-xs text-[#A8B2B2]">You can close this tab to leave setup without granting access.</p>
              <SignInModal isOpen={signInOpen} onOpenChange={setSignInOpen} />
            </>
          ) : cancelled ? (
            <>
              <h1 id="consent-heading" className="text-xl font-semibold">Connection cancelled</h1>
              <p className="mt-3 text-sm text-[#A8B2B2]">No access was granted. You can close this tab and return to your client.</p>
              {cancelRedirect ? <a href={cancelRedirect} className="inline-flex mt-5 rounded-lg bg-[#78fcd6] px-4 py-2 text-sm font-medium text-[#0B0F0F] hover:bg-[#78fcd6]/90">Return to {consent?.clientName || 'your client'}</a> : null}
            </>
          ) : !consent ? (
            error ? (
              <>
                <h1 id="consent-heading" className="text-xl font-semibold">Unable to load connection request</h1>
                <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>
                <p className="mt-3 text-sm text-[#A8B2B2]">If this request has expired, restart the connection in ChatGPT or Codex.</p>
                <Button onClick={() => setRefresh((value) => value + 1)} variant="outline" className="mt-5 border-white/10 hover:bg-white/5">Try again</Button>
              </>
            ) : <p role="status" className="flex items-center gap-2 text-sm text-[#A8B2B2]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading connection request…</p>
          ) : (
            <>
              <h1 id="consent-heading" className="text-2xl font-semibold leading-tight">Connect {consent.clientName} to ZeroBoard</h1>
              <p className="mt-3 text-sm text-[#A8B2B2]">Signed in as <span className="text-[#F2F7F7] break-all">{user?.email}</span></p>
              <div className="mt-6 rounded-lg border border-[#78fcd6]/20 bg-[#78fcd6]/5 p-4">
                <h2 className="text-sm font-medium mb-3">This client is requesting permission to:</h2>
                <ul className="space-y-2 text-sm text-[#A8B2B2]">{consent.scopes.map((scope) => <li key={scope} className="flex items-start gap-2"><Check className="h-4 w-4 mt-0.5 shrink-0 text-[#78fcd6]" aria-hidden="true" />{permissionLabel(scope) || `Unsupported permission: ${scope}`}</li>)}</ul>
              </div>

              <fieldset className="mt-6" disabled={!!busy || unknownScopes}>
                <legend className="font-medium text-sm">Choose boards to share</legend>
                <p className="text-xs text-[#A8B2B2] mt-2 mb-3">Only the boards you select will be accessible. New boards stay private.</p>
                {consent.boards.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {consent.boards.map((board) => {
                      const disabled = needsEditor && !board.canAddCards;
                      return <label key={board.id} className={`flex items-center gap-3 rounded-lg border p-3 ${disabled ? 'border-white/5 opacity-50' : 'border-white/10 hover:border-[#78fcd6]/30 cursor-pointer'} ${selected.includes(board.id) ? 'bg-[#78fcd6]/5 border-[#78fcd6]/30' : 'bg-[#0B0F0F]'}`}>
                        <input type="checkbox" checked={selected.includes(board.id)} disabled={disabled} onChange={(event) => setSelected((current) => event.target.checked ? [...current, board.id] : current.filter((id) => id !== board.id))} className="h-4 w-4 accent-[#78fcd6] shrink-0" />
                        <span className="min-w-0"><span className="block text-sm break-words">{board.name}</span>{disabled ? <span className="block text-xs text-[#A8B2B2] mt-0.5">Read-only board · editor access required to add cards</span> : null}</span>
                      </label>;
                    })}
                  </div>
                ) : <p className="text-sm text-[#A8B2B2]">You have no boards available to share. Create a board in ZeroBoard, then restart setup.</p>}
              </fieldset>
              {consent.boards.length > 0 && eligibleBoards.length === 0 ? <p className="text-sm text-amber-300 mt-3">You need owner or editor access to share boards with permission to add cards.</p> : null}
              {unknownScopes ? <p role="alert" className="text-sm text-red-300 mt-4">This client requested an unsupported permission. Cancel and restart setup.</p> : null}
              {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
              <div className="flex items-start gap-2 mt-5 text-xs leading-relaxed text-[#A8B2B2]"><ShieldCheck className="w-4 h-4 shrink-0 text-[#78fcd6]" aria-hidden="true" /><p>Access lasts up to 15 minutes. This client cannot edit existing cards or delete your work. You can disconnect from Account at any time.</p></div>
              <div className="grid grid-cols-2 gap-3 mt-6">
                <Button disabled={!!busy} variant="outline" onClick={cancel} className="border-white/10 hover:bg-white/5">{busy === 'cancel' ? 'Cancelling…' : 'Cancel'}</Button>
                <Button disabled={!canApprove} onClick={approve} className="bg-[#78fcd6] text-[#0B0F0F] hover:bg-[#78fcd6]/90">{busy === 'approve' ? 'Connecting…' : 'Allow connection'}</Button>
              </div>
              {busy === 'approve' ? <p role="status" className="mt-3 text-xs text-[#A8B2B2]">Access may finish being approved if you leave. Review or disconnect approved access in Account.</p> : null}
              {selected.length === 0 ? <p className="mt-3 text-center text-xs text-[#A8B2B2]">Select at least one board to allow access.</p> : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

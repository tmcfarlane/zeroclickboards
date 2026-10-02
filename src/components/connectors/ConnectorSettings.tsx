import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { connectorRequest, permissionLabel } from './connector-api';
import type { ConnectorConnection, ConnectorStatus } from './connector-api';
import { nativeSetupCommand } from './connector-setup';

export function ConnectorSettings() {
  const { session } = useAuthContext();
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState<'url' | 'id' | 'command' | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<ConnectorConnection | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const copyGeneration = useRef(0);
  const setupClients = status?.clients?.filter(client => client.callbackKinds.length > 0) || [];
  const configuredClient = setupClients.find(client => client.clientId === clientId) || setupClients[0];
  const command = status?.endpoint && configuredClient?.callbackKinds.includes('native')
    ? nativeSetupCommand(status.endpoint, configuredClient.clientId) : null;

  useEffect(() => {
    ++copyGeneration.current;
    setStatus(null);
    setError(null);
    setCopied(null);
    setCopyError(null);
    if (!session) return;
    const controller = new AbortController();
    connectorRequest<ConnectorStatus>(session, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setStatus(data); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load connections.');
      });
    return () => controller.abort();
  }, [session, refresh]);

  const copyText = async (value: string, kind: 'url' | 'id' | 'command') => {
    const generation = ++copyGeneration.current;
    setCopyError(null);
    setCopied(null);
    try {
      await navigator.clipboard.writeText(value);
      if (generation === copyGeneration.current) setCopied(kind);
    } catch {
      if (generation === copyGeneration.current) setCopyError('Copy was blocked by your browser. Select the text and copy it manually.');
    }
  };

  const revoke = async () => {
    if (!session || !disconnect || revoking) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await connectorRequest(session, { body: { action: 'revoke', connectionId: disconnect.id } });
      setStatus((current) => current ? { ...current, connections: current.connections.filter((item) => item.id !== disconnect.id) } : null);
      setDisconnect(null);
    } catch (cause) {
      setRevokeError(cause instanceof Error ? cause.message : 'Unable to disconnect. Please try again.');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <section id="connectors" aria-labelledby="connectors-heading" className="scroll-mt-8 rounded-xl border border-[#78fcd6]/25 bg-[#111515] p-6 mb-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#78fcd6]/10 text-[#78fcd6]">
          <Link2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 id="connectors-heading" className="text-lg font-semibold">ChatGPT &amp; Codex</h2>
          <p className="mt-1 text-sm text-[#A8B2B2]">Bring your boards into the conversations where work starts.</p>
        </div>
      </div>

      {!status && !error ? (
        <p className="flex items-center gap-2 text-sm text-[#A8B2B2]" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking connection service…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-4">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button variant="outline" onClick={() => setRefresh((value) => value + 1)} className="mt-3 border-white/10 hover:bg-white/5">Try again</Button>
        </div>
      ) : status ? (
        <>
          <div className="flex items-center gap-2 text-xs font-medium mb-4">
            <span className={`h-2 w-2 rounded-full ${status.available ? 'bg-[#78fcd6]' : 'bg-amber-400'}`} aria-hidden="true" />
            <span className={status.available ? 'text-[#78fcd6]' : 'text-amber-300'}>{status.available ? 'Connection service ready' : 'Connection service unavailable'}</span>
          </div>
          {status.available && status.endpoint ? (
            <>
              <p className="text-sm text-[#A8B2B2] mb-4">Read selected boards, turn meeting notes into tasks, and review new cards before adding them.</p>
              <div className="rounded-lg border border-white/10 bg-[#0B0F0F] p-4">
                <label htmlFor="connector-endpoint" className="block text-xs font-medium text-[#A8B2B2] mb-2">Connection URL</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input id="connector-endpoint" readOnly value={status.endpoint} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm text-[#F2F7F7] font-mono focus:outline-none focus:ring-2 focus:ring-[#78fcd6]/50" />
                  <Button onClick={() => void copyText(status.endpoint!, 'url')} className="bg-[#78fcd6] text-[#0B0F0F] hover:bg-[#78fcd6]/90 shrink-0">
                    {copied === 'url' ? <Check className="w-4 h-4 mr-2" aria-hidden="true" /> : <Copy className="w-4 h-4 mr-2" aria-hidden="true" />}{copied === 'url' ? 'URL copied' : 'Copy URL'}
                  </Button>
                </div>
                {copied ? <p role="status" className="mt-2 text-xs text-[#78fcd6]">{copied === 'url' ? 'URL' : copied === 'id' ? 'Client ID' : 'Command'} copied. Complete setup in your client to connect.</p> : null}
                {copyError ? <p role="alert" className="mt-2 text-xs text-red-300">{copyError}</p> : null}
              </div>
              {configuredClient ? (
                <div className="mt-4 rounded-lg border border-white/10 p-4">
                  <p className="text-sm text-[#A8B2B2]">Use the required OAuth client ID below during setup. This is a public client; no client secret is needed.</p>
                  {setupClients.length > 1 ? (
                    <div className="mt-3">
                      <label htmlFor="connector-client" className="text-xs text-[#A8B2B2] block mb-1">Client</label>
                      <select id="connector-client" value={configuredClient.clientId} onChange={(event) => { ++copyGeneration.current; setClientId(event.target.value); setCopied(null); setCopyError(null); }} className="w-full rounded-md border border-white/10 bg-[#0B0F0F] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#78fcd6]/50">{setupClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.name} · {client.callbackKinds.map(kind => kind === 'native' ? 'Codex' : 'ChatGPT').join(' / ')}</option>)}</select>
                    </div>
                  ) : null}
                  <label htmlFor="connector-client-id" className="text-xs text-[#A8B2B2] block mt-3 mb-1">{configuredClient.name} OAuth client ID</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input id="connector-client-id" readOnly value={configuredClient.clientId} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#0B0F0F] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#78fcd6]/50" />
                    <Button variant="outline" onClick={() => void copyText(configuredClient.clientId, 'id')} className="border-white/10 hover:bg-white/5">Copy client ID</Button>
                  </div>
                  {configuredClient.callbackKinds.includes('chatgpt') ? (
                    <div className="mt-4 text-sm text-[#A8B2B2]">
                      <h3 className="font-medium text-[#F2F7F7]">ChatGPT web setup</h3>
                      <p className="mt-2">Enable Developer mode in Settings → Security and login. Add the Connection URL in ChatGPT Plugins and use the public client ID above for OAuth. Leave the client secret empty. If your setup screen cannot accept a predefined client ID, this connection method is unavailable there.</p>
                      <a href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noreferrer" className="inline-flex mt-3 text-xs text-[#78fcd6] hover:underline">ChatGPT setup guide ↗</a>
                    </div>
                  ) : null}
                  {command ? (
                    <div className="mt-4 text-sm text-[#A8B2B2]">
                      <h3 className="font-medium text-[#F2F7F7]">Codex app &amp; CLI setup</h3>
                      <p className="mt-2">Run this command in a macOS or Linux terminal with Codex installed. The app and CLI share this configuration. Restart the app after setup. Use a different server name if zeroboard is already configured.</p>
                      <pre className="mt-3 whitespace-pre-wrap break-all rounded-md border border-white/10 bg-[#0B0F0F] p-3 text-xs text-[#F2F7F7]"><code>{command}</code></pre>
                      <Button variant="outline" onClick={() => void copyText(command, 'command')} className="mt-2 border-white/10 hover:bg-white/5">Copy Codex command</Button>
                      <p className="mt-2 text-xs">To sign in again after access expires, run <code>codex mcp login zeroboard</code> with the server name you chose.</p>
                      <a href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli" target="_blank" rel="noreferrer" className="inline-flex mt-3 text-xs text-[#78fcd6] hover:underline">Codex setup guide ↗</a>
                    </div>
                  ) : null}
                  <p className="mt-4 text-sm text-[#A8B2B2]">Sign in with your ZeroBoard account, select the boards to share, then review and allow access. Return to your client and try a board read to confirm setup completed.</p>
                </div>
              ) : <p className="mt-4 text-sm text-amber-300">This deployment has no configured ChatGPT web or default native Codex client. Contact the operator for client setup.</p>}
              <p className="mt-3 text-xs text-[#A8B2B2]">Custom connections depend on your client’s plan and workspace settings.</p>
              <p className="mt-2 text-xs text-[#A8B2B2]">Connections last up to 15 minutes. Reconnect in ChatGPT or Codex to continue after access expires.</p>
            </>
          ) : (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-[#A8B2B2]">
              <p>{status.reason || 'New connections are temporarily unavailable. Try again later.'}</p>
              <Button variant="outline" onClick={() => setRefresh((value) => value + 1)} className="mt-3 border-white/10 hover:bg-white/5">Check again</Button>
            </div>
          )}

          <div className="mt-6 border-t border-white/10 pt-5">
            <h3 className="font-medium text-sm mb-3">Approved access</h3>
            <p className="text-xs text-[#A8B2B2] mb-3">Finish sign-in in your client. Approval alone does not confirm the client is connected.</p>
            {status.connections.length === 0 ? (
              <p className="text-sm text-[#A8B2B2]">{status.available
                ? 'No approved access yet. Your boards stay private until you choose to share them.'
                : 'Approved access cannot currently be checked. Try again when the connection service is available.'}</p>
            ) : (
              <ul className="space-y-3">
                {status.connections.map((connection) => (
                  <li key={connection.id} className="rounded-lg border border-white/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{connection.clientName}</p>
                        <p className="mt-1 text-xs text-[#A8B2B2]">{connection.boardIds.length} selected {connection.boardIds.length === 1 ? 'board' : 'boards'} · Expires {new Date(connection.expiresAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setRevokeError(null); setDisconnect(connection); }} className="text-[#A8B2B2] hover:text-red-300 hover:bg-red-400/5 shrink-0"><Unplug className="w-4 h-4 mr-2" aria-hidden="true" />Disconnect</Button>
                    </div>
                    {connection.boards?.length ? <p className="text-sm text-[#A8B2B2] mt-2">{connection.boards.map((board) => board.name).join(', ')}</p> : null}
                    <ul className="mt-3 space-y-1 text-xs text-[#A8B2B2]">{connection.scopes.map((scope) => <li key={scope}>{permissionLabel(scope) || scope}</li>)}</ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <div className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-[#A8B2B2]">
        <ShieldCheck className="w-4 h-4 shrink-0 text-[#78fcd6]" aria-hidden="true" />
        <p>You control access per board and can disconnect at any time. Connections cannot edit existing cards or delete your work.</p>
      </div>

      <AlertDialog open={!!disconnect} onOpenChange={(open) => { if (!open && !revoking) setDisconnect(null); }}>
        <AlertDialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnect?.clientName}?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#A8B2B2]">This client will lose access to your selected boards. Cards already added to ZeroBoard will stay.</AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError ? <p role="alert" className="text-sm text-red-300">{revokeError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking} className="border-white/10 bg-transparent hover:bg-white/5">Keep connection</AlertDialogCancel>
            <AlertDialogAction disabled={revoking} onClick={(event) => { event.preventDefault(); void revoke(); }} className="bg-red-500 text-white hover:bg-red-600">{revoking ? 'Disconnecting…' : 'Disconnect'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

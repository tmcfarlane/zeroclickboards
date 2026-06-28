import { WEB_BASE_URL } from './config.js';
import type { BoardTemplate } from './types.js';

/**
 * Generate a board template from a natural-language prompt by calling the web
 * app's existing /api/ai/board-template endpoint with the user's access token.
 * That endpoint runs the AI gateway and enforces the daily free-tier limit, so
 * we don't reimplement any of that here.
 */
export async function generateBoardTemplate(prompt: string, accessToken: string): Promise<BoardTemplate> {
  let res: Response;
  try {
    res = await fetch(`${WEB_BASE_URL}/api/ai/board-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    throw new Error(`Could not reach ZeroBoard AI: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (res.status === 401) {
    throw new Error('Not authorized for AI. Run `zeroboard-mcp login` again.');
  }
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { usage?: { resetsAt?: string } };
    const resets = body.usage?.resetsAt ? ` Resets at ${body.usage.resetsAt}.` : '';
    throw new Error(`Daily AI limit reached.${resets} Upgrade to ZeroBoard Pro for unlimited AI.`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`AI board generation failed (${res.status})${body.error ? `: ${body.error}` : ''}`);
  }

  const data = (await res.json()) as { template?: BoardTemplate };
  if (!data.template) throw new Error('AI returned no template.');
  return data.template;
}

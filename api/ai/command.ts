import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getUserFromRequest, hasActiveSubscription, getDailyAIUsage, logAIUsage, isAdmin, FREE_DAILY_AI_LIMIT, AI_WARNING_THRESHOLD, FREE_DAILY_AI_ABUSE_LIMIT } from '../_lib/auth.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 45,
};

type AICommandType =
  | 'create_board'
  | 'rename_board'
  | 'delete_board'
  | 'add_column'
  | 'rename_column'
  | 'remove_column'
  | 'add_card'
  | 'edit_card'
  | 'remove_card'
  | 'move_card'
  | 'set_target_date'
  | 'switch_view'
  | 'extract_card_json'
  | 'extract_column_json'
  | 'clear_column'
  | 'count_cards'
  | 'rename_card'
  | 'add_label'
  | 'remove_label'
  | 'add_checklist'
  | 'set_description'
  | 'archive_card'
  | 'restore_card'
  | 'duplicate_card'
  | 'unknown';

type AICommand = {
  type: AICommandType;
  params: Record<string, unknown>;
  originalText: string;
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function safeParseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function isAICommand(value: unknown): value is AICommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && typeof v.originalText === 'string' && typeof v.params === 'object' && !!v.params;
}

const SYSTEM_PROMPT =
  'You are a command parser for a Trello-like kanban app. ' +
  'For single operations, return ONLY a JSON object: { "type": "...", "params": {...}, "originalText": "..." }. ' +
  'For requests involving multiple operations (e.g. "create column Review and add 3 tasks"), return: { "commands": [{ "type": "...", "params": {...}, "originalText": "..." }, ...] }. ' +
  'Supported types: create_board, delete_board, rename_board, add_column, remove_column, rename_column, add_card, remove_card, edit_card, move_card, set_target_date, switch_view, extract_card_json, extract_column_json, clear_column, count_cards, rename_card, add_label, remove_label, add_checklist, set_description, archive_card, restore_card, duplicate_card, unknown. ' +
  'params must be an object with relevant keys. ' +
  'Always try to map the user\'s intent to the closest matching action. ' +
  'When the user refers to "it", "that", or "this", resolve it using the last command context provided. For example, if the last command added a card titled "Fix bug", and the user says "move it to Done", the cardTitle should be "Fix bug". ' +
  'For add_card, if the user requests a checklist or specifies items/steps/tasks, include a "checklistItems" array of strings in params. Example: "Create a checklist \'Sprint tasks\' with items: design, build, test" → add_card with params { title: "Sprint tasks", checklistItems: ["design", "build", "test"] }. ' +
  'Examples: "Add a TODO item \'X\'" means add_card with title "X". "Put \'Y\' in Done" means add_card or move_card. ' +
  '"Create a reminder to update docs" means add_card. "Add a quick note \'Z\'" means add_card. ' +
  'For extract_card_json, params should include "cardTitle". For extract_column_json, params should include "columnTitle". ' +
  'For clear_column, params should include "columnTitle". For count_cards, params should include "columnTitle" (optional, omit to count all). For rename_card, params should include "cardTitle" and "newTitle". ' +
  'When the user asks to add N tasks (e.g. "Add 5 tasks to TODO" or "Add 10 random tasks"), return a batch { "commands": [...] } with N separate add_card commands, each with a unique realistic task title. ' +
  'When the user lists multiple items (e.g. "Add tasks: design, build, test to TODO"), return a batch with one add_card per item. ' +
  'Examples: "Export the Done column as JSON" → extract_column_json with columnTitle "Done". "Clear the TODO column" → clear_column with columnTitle "TODO". ' +
  '"How many cards in Done?" → count_cards with columnTitle "Done". "Rename card \'old\' to \'new\'" → rename_card with cardTitle "old" and newTitle "new". ' +
  // Label commands
  'For add_label, params: { "cardTitle": "..." (optional), "label": "red"|"yellow"|"green"|"blue"|"purple"|"gray", "allCards": true|false }. ' +
  'Use allCards:true when the user says "all tasks", "every card", "each card", etc. ' +
  'Examples: "Give each card a red label" → add_label with { label: "red", allCards: true }. "Add a blue label to \'Fix bug\'" → add_label with { cardTitle: "Fix bug", label: "blue" }. "Label all tasks green" → add_label with { label: "green", allCards: true }. ' +
  'For remove_label, params: { "cardTitle": "..." (optional), "label": "red"|"yellow"|"green"|"blue"|"purple"|"gray", "allCards": true|false }. ' +
  // Checklist commands
  'For add_checklist (adding a checklist to an EXISTING card), params: { "cardTitle": "..." (optional), "checklistItems": ["item1", "item2", ...], "allCards": true|false }. ' +
  'Use add_checklist when the user wants to add a checklist to existing cards. Use add_card when creating a NEW card with a checklist. ' +
  'Examples: "Add a checklist to \'Fix bug\' with items: investigate, fix, test" → add_checklist with { cardTitle: "Fix bug", checklistItems: ["investigate", "fix", "test"] }. ' +
  '"Add checklists to every task" → add_checklist with { checklistItems: ["To do", "In progress", "Done"], allCards: true }. ' +
  // Description commands
  'For set_description, params: { "cardTitle": "..." (optional), "description": "..." }. ' +
  'Example: "Set description of \'Fix bug\' to \'Investigate the login timeout issue\'" → set_description with { cardTitle: "Fix bug", description: "Investigate the login timeout issue" }. ' +
  // Archive/restore/duplicate commands
  'For archive_card, params: { "cardTitle": "..." }. For restore_card, params: { "cardTitle": "..." }. For duplicate_card, params: { "cardTitle": "..." }. ' +
  'Examples: "Archive \'Old task\'" → archive_card. "Restore \'Old task\'" → restore_card. "Duplicate \'Design review\'" → duplicate_card. ' +
  'Only use type "unknown" if the request is completely unrelated to board management.';

export default async function handler(req: Request) {
  const t0 = performance.now();
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Auth + subscription gating
  const authUser = await getUserFromRequest(req);
  const tAuth = performance.now();
  if (!authUser) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const admin = isAdmin(authUser.email);
  const [subscribed, dailyUsage] = await Promise.all([
    hasActiveSubscription(authUser.token, authUser.userId, process.env.STRIPE_PRICE_ID),
    getDailyAIUsage(authUser.token, authUser.userId),
  ]);
  const uncapped = subscribed || admin;
  const tGating = performance.now();

  if (!uncapped && (dailyUsage.charged >= FREE_DAILY_AI_LIMIT || dailyUsage.total >= FREE_DAILY_AI_ABUSE_LIMIT)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowPacific = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
    const offsetHours = parseInt(offsetPart.replace('GMT', ''), 10);
    const resetsAtDate = new Date(tomorrowPacific + 'T00:00:00Z');
    resetsAtDate.setUTCHours(resetsAtDate.getUTCHours() - offsetHours);

    return jsonResponse(429, {
      error: 'AI_DAILY_LIMIT_REACHED',
      usage: { used: dailyUsage.charged, limit: FREE_DAILY_AI_LIMIT, resetsAt: resetsAtDate.toISOString() },
    });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const modelId = process.env.AI_GATEWAY_MODEL || 'gpt-5.2';

  if (!apiKey) {
    return jsonResponse(500, { error: 'Missing AI_GATEWAY_API_KEY' });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const body = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : null;
  const text = typeof body?.text === 'string' ? body.text : '';
  const context = typeof body?.context === 'string' ? body.context : '';
  const lastCommand = body?.lastCommand && typeof body.lastCommand === 'object' ? body.lastCommand as Record<string, unknown> : null;

  if (!text.trim()) {
    return jsonResponse(400, { error: 'Missing text' });
  }

  let userPrompt = `User text: ${text}\n\nBoard context (optional):\n${context}`;
  if (lastCommand) {
    userPrompt += `\n\nLast command context: ${JSON.stringify(lastCommand)}`;
  }

  const gateway = createOpenAI({
    baseURL: 'https://ai-gateway.vercel.sh/v1',
    apiKey,
  });

  const tPreFetch = performance.now();

  let aiText: string;
  try {
    const result = await generateText({
      model: gateway(modelId),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(30_000),
    });
    aiText = result.text;
  } catch (err) {
    const tFail = performance.now();
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    console.error('[ai/command] generateText failed:', isTimeout ? 'timeout after 30s' : err);
    return jsonResponse(isTimeout ? 504 : 502, {
      error: isTimeout ? 'AI gateway timed out' : 'AI gateway error',
      timing: { authMs: Math.round(tAuth - t0), gatewayMs: Math.round(tFail - tPreFetch), totalMs: Math.round(tFail - t0) },
    });
  }

  const tGateway = performance.now();

  const parsed = safeParseJsonObject(aiText);

  // Determine the resolved command type to decide whether to charge
  const root0 = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  const commandType = root0
    ? (isAICommand(parsed) ? (parsed as AICommand).type : Array.isArray(root0.commands) ? (root0.commands[0] as Record<string, unknown>)?.type : 'unknown')
    : 'unknown';
  const resolvedType = typeof commandType === 'string' ? commandType : 'unknown';
  const isCharged = resolvedType !== 'unknown';

  // Fire-and-forget — always log for analytics, but command_type determines charged vs uncharged
  logAIUsage(authUser.token, authUser.userId, text, resolvedType)
    .catch((err) => console.error('[ai/command] logAIUsage failed:', err));
  const tEnd = performance.now();

  const ms = (a: number, b: number) => Math.round(b - a);
  const timing = {
    authMs: ms(t0, tAuth),
    gatingMs: ms(tAuth, tGating),
    gatewayMs: ms(tPreFetch, tGateway),
    logMs: ms(tGateway, tEnd),
    totalMs: ms(t0, tEnd),
  };
  console.log('[ai/command] timing:', JSON.stringify(timing));

  // Compute usage metadata — only increment 'used' for charged (non-unknown) commands
  const used = isCharged ? dailyUsage.charged + 1 : dailyUsage.charged;
  const usage = {
    used,
    limit: uncapped ? null : FREE_DAILY_AI_LIMIT,
    warning: !uncapped && used >= AI_WARNING_THRESHOLD,
    charged: isCharged,
  };

  if (!parsed || typeof parsed !== 'object') {
    return jsonResponse(200, { command: { type: 'unknown', params: {}, originalText: text }, usage, timing });
  }

  const root = parsed as Record<string, unknown>;

  // Batch response: { commands: [...] }
  if (Array.isArray(root.commands)) {
    const valid = root.commands.filter(isAICommand);
    if (valid.length > 0) {
      return jsonResponse(200, { commands: valid, usage, timing });
    }
    return jsonResponse(200, { command: { type: 'unknown', params: {}, originalText: text }, usage, timing });
  }

  // Single response: { type, params, originalText }
  if (isAICommand(parsed)) {
    return jsonResponse(200, { command: parsed, usage, timing });
  }

  return jsonResponse(200, { command: { type: 'unknown', params: {}, originalText: text }, usage, timing });
}

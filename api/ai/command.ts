export const config = {
  runtime: 'nodejs',
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

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const model = process.env.AI_GATEWAY_MODEL || 'gpt-5.2';

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

  const system =
    'You are a command parser for a Trello-like kanban app. ' +
    'For single operations, return ONLY a JSON object: { "type": "...", "params": {...}, "originalText": "..." }. ' +
    'For requests involving multiple operations (e.g. "create column Review and add 3 tasks"), return: { "commands": [{ "type": "...", "params": {...}, "originalText": "..." }, ...] }. ' +
    'Supported types: create_board, delete_board, rename_board, add_column, remove_column, rename_column, add_card, remove_card, edit_card, move_card, set_target_date, switch_view, unknown. ' +
    'params must be an object with relevant keys. ' +
    'Always try to map the user\'s intent to the closest matching action. ' +
    'When the user refers to "it", "that", or "this", resolve it using the last command context provided. For example, if the last command added a card titled "Fix bug", and the user says "move it to Done", the cardTitle should be "Fix bug". ' +
    'For add_card, if the user requests a checklist or specifies items/steps/tasks, include a "checklistItems" array of strings in params. Example: "Create a checklist \'Sprint tasks\' with items: design, build, test" → add_card with params { title: "Sprint tasks", checklistItems: ["design", "build", "test"] }. ' +
    'Examples: "Add a TODO item \'X\'" means add_card with title "X". "Put \'Y\' in Done" means add_card or move_card. ' +
    '"Create a reminder to update docs" means add_card. "Add a quick note \'Z\'" means add_card. ' +
    'Only use type "unknown" if the request is completely unrelated to board management.';

  let user = `User text: ${text}\n\nBoard context (optional):\n${context}`;
  if (lastCommand) {
    user += `\n\nLast command context: ${JSON.stringify(lastCommand)}`;
  }

  const upstream = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return jsonResponse(502, { error: 'AI gateway error', detail: errText });
  }

  const upstreamJson: unknown = await upstream.json();

  const content = (() => {
    if (!upstreamJson || typeof upstreamJson !== 'object') return null;
    const root = upstreamJson as Record<string, unknown>;
    const choices = root.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0];
    if (!first || typeof first !== 'object') return null;
    const msg = (first as Record<string, unknown>).message;
    if (!msg || typeof msg !== 'object') return null;
    const c = (msg as Record<string, unknown>).content;
    return typeof c === 'string' ? c : null;
  })();
  const parsed = typeof content === 'string' ? safeParseJsonObject(content) : null;

  if (!parsed || typeof parsed !== 'object') {
    return jsonResponse(200, { command: { type: 'unknown', params: {}, originalText: text } });
  }

  const root = parsed as Record<string, unknown>;

  // Batch response: { commands: [...] }
  if (Array.isArray(root.commands)) {
    const valid = root.commands.filter(isAICommand);
    if (valid.length > 0) {
      return jsonResponse(200, { commands: valid });
    }
    return jsonResponse(200, { command: { type: 'unknown', params: {}, originalText: text } });
  }

  // Single response: { type, params, originalText }
  if (isAICommand(parsed)) {
    return jsonResponse(200, { command: parsed });
  }

  return jsonResponse(200, { command: { type: 'unknown', params: {}, originalText: text } });
}

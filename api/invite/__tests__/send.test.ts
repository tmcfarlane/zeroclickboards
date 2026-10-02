// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../send.js';
import type { NodeRes } from '../../_lib/auth.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  adminClient: vi.fn(),
  constructResend: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('../../_lib/auth.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../_lib/auth.js')>(),
  getUserFromRequest: mocks.authenticate,
  createServiceClient: mocks.adminClient,
}));
vi.mock('resend', () => ({
  Resend: class {
    constructor(key: string) { mocks.constructResend(key); }
    emails = { send: mocks.sendEmail };
  },
}));

const owner = '11111111-1111-4111-8111-111111111111';
const invitee = '22222222-2222-4222-8222-222222222222';
const boardId = '33333333-3333-4333-8333-333333333333';
type Step = 'ownership' | 'inviter' | 'invite' | 'lookup' | 'member' | 'cleanup';
type Result = { data: unknown; error: { message: string } | null };
type Operation = { table: string; action: 'select' | 'upsert' | 'delete'; fields: string; values?: Record<string, unknown>; filters: Record<string, unknown> };
let overrides: Partial<Record<Step, Result | Error>>;
let operations: { step: Step; query: Operation }[];
let order: string[];

function database() {
  return { from: vi.fn((table: string) => {
    const query: Operation = { table, action: 'select', fields: '', filters: {} };
    const finish = (): Result => {
      const step: Step = table === 'boards' ? 'ownership' : table === 'profiles' ? (query.fields === 'id' ? 'lookup' : 'inviter') :
        table === 'board_members' ? 'member' : query.action === 'delete' ? 'cleanup' : 'invite';
      operations.push({ step, query }); order.push(step);
      const override = overrides[step];
      if (override instanceof Error) throw override;
      if (override) return override;
      const data = step === 'ownership' ? { user_id: owner, name: 'Owned fixture board' } :
        step === 'inviter' ? { full_name: 'Fixture owner', email: 'owner@fixture.invalid' } :
        step === 'lookup' ? null : query.values ?? null;
      return { data, error: null };
    };
    const builder = {
      select(fields: string) { query.fields = fields; return builder; },
      eq(column: string, value: unknown) { query.filters[column] = value; return builder; },
      upsert(values: Record<string, unknown>) { query.action = 'upsert'; query.values = values; return builder; },
      delete() { query.action = 'delete'; return builder; },
      async single() { return finish(); },
      async maybeSingle() { return finish(); },
      then(resolve: (result: Result) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve().then(finish).then(resolve, reject);
      },
    };
    return builder;
  }) };
}

async function request(body: Record<string, unknown> = {}, origin = 'https://board.zeroclickdev.ai') {
  let raw = '';
  const res: NodeRes = { statusCode: 0, setHeader: vi.fn(), end(value) { raw = String(value ?? ''); } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer fixture-access-token', origin },
    body: { email: ' Invited@fixture.invalid ', boardId, role: 'editor', ...body } }, res);
  return { status: res.statusCode, body: JSON.parse(raw) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_fixture_only');
  vi.stubEnv('ZEROBOARD_CONNECTOR_ISSUER', '');
  overrides = {}; operations = []; order = [];
  mocks.authenticate.mockResolvedValue({ userId: owner, email: 'owner@fixture.invalid', token: 'fixture-access-token' });
  mocks.adminClient.mockReturnValue(database());
  mocks.sendEmail.mockImplementation(async () => { order.push('email'); return { data: { id: 'fixture-email-id' }, error: null }; });
});
afterEach(() => vi.unstubAllEnvs());

function expectNoEmail() {
  expect(mocks.constructResend).not.toHaveBeenCalled();
  expect(mocks.sendEmail).not.toHaveBeenCalled();
}

describe('invite ownership and durable persistence', () => {
  it.each(['throws', 'null'])('fails closed when the admin client is unavailable (%s)', async mode => {
    if (mode === 'throws') mocks.adminClient.mockImplementation(() => { throw new Error('Fixture admin unavailable'); });
    else mocks.adminClient.mockReturnValue(null);
    const result = await request();
    expect(result.status).toBe(503);
    expect(result.body.success).toBeUndefined();
    expect(result.body.accessSaved).toBeUndefined();
    expect(operations).toHaveLength(0);
    expectNoEmail();
  });

  it.each([
    { data: { user_id: invitee, name: 'Foreign board' }, error: null },
    { data: { user_id: owner, name: 'Untrusted partial result' }, error: { message: 'Fixture query rejected' } },
    { data: null, error: null },
  ])('requires an error-free board owned by the authenticated caller', async result => {
    overrides.ownership = result;
    expect((await request()).status).toBe(403);
    expect(order).toEqual(['ownership']);
    expectNoEmail();
  });

  it.each([
    { data: null, error: { message: 'Fixture invitation upsert rejected' } },
    { data: null, error: null },
    { data: { board_id: boardId, email: 'invited@fixture.invalid', role: 'viewer', invited_by: owner }, error: null },
  ])('does not send mail or report success without the requested invitation acknowledgement', async result => {
    overrides.invite = result;
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.body.success).toBeUndefined();
    expect(response.body.accessSaved).toBeUndefined();
    expect(order).toEqual(['ownership', 'inviter', 'invite']);
    expectNoEmail();
  });

  it('does not treat an invitee lookup failure as a missing account', async () => {
    overrides.lookup = { data: null, error: { message: 'Fixture lookup unavailable' } };
    const result = await request();
    expect(result.status).toBe(503);
    expect(result.body.accessSaved).toBe(true);
    expect(order).toEqual(['ownership', 'inviter', 'invite', 'lookup']);
    expectNoEmail();
  });

  it.each([
    { data: null, error: { message: 'Fixture membership upsert rejected' } },
    { data: null, error: null },
    { data: { board_id: boardId, user_id: owner, role: 'editor', invited_by: owner }, error: null },
  ])('keeps the pending invitation and sends no mail when membership persistence fails', async result => {
    overrides.lookup = { data: { id: invitee }, error: null };
    overrides.member = result;
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.body.success).toBeUndefined();
    expect(response.body.accessSaved).toBe(true);
    expect(order).toEqual(['ownership', 'inviter', 'invite', 'lookup', 'member']);
    expect(operations.some(operation => operation.query.action === 'delete')).toBe(false);
    expectNoEmail();
  });

  it('requires successful pending-invite cleanup after the member is confirmed', async () => {
    overrides.lookup = { data: { id: invitee }, error: null };
    overrides.cleanup = { data: null, error: { message: 'Fixture cleanup rejected' } };
    const result = await request();
    expect(result.status).toBe(503);
    expect(result.body.accessSaved).toBe(true);
    expect(order).toEqual(['ownership', 'inviter', 'invite', 'lookup', 'member', 'cleanup']);
    expectNoEmail();
  });

  it('returns a controlled failure when persistence throws', async () => {
    overrides.invite = new Error('Fixture transport rejected');
    const result = await request();
    expect(result).toEqual({ status: 503, body: { error: 'Failed to save invitation' } });
    expectNoEmail();
  });

  it('reports the acknowledged invitation when a later lookup throws', async () => {
    overrides.lookup = new Error('Fixture lookup transport rejected');
    const result = await request();
    expect(result).toEqual({ status: 503, body: { error: 'Failed to save invitation', accessSaved: true } });
    expect(order).toEqual(['ownership', 'inviter', 'invite', 'lookup']);
    expectNoEmail();
  });

  it.each([false, true])('reports saved access when email is rejected after persistence (existing account=%s)', async existing => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      if (existing) overrides.lookup = { data: { id: invitee }, error: null };
      mocks.sendEmail.mockImplementation(async () => {
        order.push('email'); return { data: null, error: { message: 'Fixture email rejected' } };
      });
      const result = await request();
      expect(result).toEqual({ status: 500, body: { error: 'Fixture email rejected', accessSaved: true } });
      expect(order).toEqual(existing ? ['ownership', 'inviter', 'invite', 'lookup', 'member', 'cleanup', 'email'] :
        ['ownership', 'inviter', 'invite', 'lookup', 'email']);
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });

  it('retains saved-access metadata when email delivery becomes ambiguous', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.sendEmail.mockRejectedValue(new Error('Fixture mail transport rejected'));
      const result = await request();
      expect(result).toEqual({ status: 500, body: { error: 'Fixture mail transport rejected', accessSaved: true } });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });

  it('sends a valid owner invitation only after its pending invite is persisted', async () => {
    const result = await request({ boardName: 'Untrusted request title' });
    expect(result).toEqual({ status: 200, body: { success: true, emailId: 'fixture-email-id' } });
    expect(order).toEqual(['ownership', 'inviter', 'invite', 'lookup', 'email']);
    expect(operations.find(operation => operation.step === 'invite')?.query.values).toEqual({
      board_id: boardId, email: 'invited@fixture.invalid', role: 'editor', invited_by: owner, board_name: 'Owned fixture board',
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'invited@fixture.invalid',
      subject: 'Fixture owner invited you to "Owned fixture board" on ZeroClickBoards' }));
  });

  it('confirms an existing account membership before cleanup and mail', async () => {
    overrides.lookup = { data: { id: invitee }, error: null };
    expect((await request()).status).toBe(200);
    expect(order).toEqual(['ownership', 'inviter', 'invite', 'lookup', 'member', 'cleanup', 'email']);
    expect(operations.find(operation => operation.step === 'member')?.query.values).toEqual({
      board_id: boardId, user_id: invitee, role: 'editor', invited_by: owner,
    });
  });
});

describe('canonical invitation links', () => {
  it('ignores malicious Origin HTML and uses the production application fallback', async () => {
    expect((await request({}, 'https://attacker.invalid/"><img src=x onerror=alert(1)>')).status).toBe(200);
    const html = mocks.sendEmail.mock.calls[0][0].html as string;
    expect(html).toContain(`href="https://board.zeroclickdev.ai/board/${boardId}"`);
    expect(html).not.toContain('attacker.invalid');
    expect(html).not.toContain('<img');
  });

  it('uses the configured HTTPS origin and encodes the board as one path segment', async () => {
    vi.stubEnv('ZEROBOARD_CONNECTOR_ISSUER', 'https://board.review.invalid');
    const pathInput = 'fixture/"?&id#';
    expect((await request({ boardId: pathInput })).status).toBe(200);
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain(`href="https://board.review.invalid/board/${encodeURIComponent(pathInput)}"`);
  });

  it.each(['http://board.review.invalid', 'https://user:password@board.review.invalid', 'https://board.review.invalid/path', 'not-an-origin'])('fails closed for invalid application origin %s', async origin => {
    vi.stubEnv('ZEROBOARD_CONNECTOR_ISSUER', origin);
    expect((await request()).status).toBe(503);
    expect(operations).toHaveLength(0);
    expectNoEmail();
  });
});

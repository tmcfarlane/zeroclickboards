import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => {
  const mockClient = {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        })),
      })),
    })),
  };
  return {
    createClient: vi.fn(() => mockClient),
    __mockClient: mockClient,
  };
});

describe('API auth helpers', () => {
  describe('getHeader', () => {
    let getHeader: (req: unknown, name: string) => string | null;

    beforeEach(async () => {
      const mod = await import('../../../api/_lib/auth');
      getHeader = mod.getHeader;
    });

    it('extracts header from Web Request-like object', () => {
      const headers = new Headers({ authorization: 'Bearer token123' });
      const req = { headers };
      expect(getHeader(req, 'authorization')).toBe('Bearer token123');
    });

    it('extracts header from Node.js IncomingMessage-like object', () => {
      const req = { headers: { authorization: 'Bearer node-token' } };
      expect(getHeader(req, 'authorization')).toBe('Bearer node-token');
    });

    it('returns null when header is missing', () => {
      const req = { headers: new Headers() };
      expect(getHeader(req, 'authorization')).toBeNull();
    });

    it('returns null when headers object is missing', () => {
      const req = {};
      expect(getHeader(req, 'authorization')).toBeNull();
    });
  });

  describe('isAdmin', () => {
    let isAdmin: (email: string) => boolean;
    const origEnv = process.env.ADMIN_EMAILS;

    beforeEach(async () => {
      const mod = await import('../../../api/_lib/auth');
      isAdmin = mod.isAdmin;
    });

    afterEach(() => {
      if (origEnv !== undefined) {
        process.env.ADMIN_EMAILS = origEnv;
      } else {
        delete process.env.ADMIN_EMAILS;
      }
    });

    it('returns true for admin email', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com,boss@example.com';
      expect(isAdmin('admin@example.com')).toBe(true);
    });

    it('is case insensitive', () => {
      process.env.ADMIN_EMAILS = 'Admin@Example.com';
      expect(isAdmin('admin@example.com')).toBe(true);
    });

    it('returns false for non-admin email', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      expect(isAdmin('user@example.com')).toBe(false);
    });

    it('returns false when ADMIN_EMAILS is empty', () => {
      process.env.ADMIN_EMAILS = '';
      expect(isAdmin('anyone@example.com')).toBe(false);
    });

    it('returns false when ADMIN_EMAILS is unset', () => {
      delete process.env.ADMIN_EMAILS;
      expect(isAdmin('anyone@example.com')).toBe(false);
    });
  });

  describe('constants', () => {
    it('exports expected AI limits', async () => {
      const mod = await import('../../../api/_lib/auth');
      expect(mod.FREE_DAILY_AI_LIMIT).toBe(5);
      expect(mod.AI_WARNING_THRESHOLD).toBe(3);
      expect(mod.FREE_DAILY_AI_ABUSE_LIMIT).toBe(15);
    });
  });

  describe('sendJson', () => {
    let sendJson: (res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string) => void }, status: number, body: unknown) => void;

    beforeEach(async () => {
      const mod = await import('../../../api/_lib/auth');
      sendJson = mod.sendJson;
    });

    it('sets status code, content-type, and sends JSON body', () => {
      const res = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn(),
      };

      sendJson(res, 200, { ok: true });

      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
    });

    it('sets error status codes', () => {
      const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
      sendJson(res, 401, { error: 'Unauthorized' });
      expect(res.statusCode).toBe(401);
    });
  });
});

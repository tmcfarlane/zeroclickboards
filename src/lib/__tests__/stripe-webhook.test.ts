import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
const mockUpdate = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ error: null })),
    then: (fn: (v: { error: null }) => void) => fn({ error: null }),
  })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: mockUpdate,
      upsert: mockUpsert,
    })),
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

vi.mock('stripe', () => {
  class MockStripe {
    webhooks = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructEvent: (body: string, sig: string, _secret?: string) => {
        if (sig === 'invalid') throw new Error('Signature verification failed');
        return JSON.parse(body);
      },
    };
    subscriptions = {
      retrieve: () =>
        Promise.resolve({
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: 'price_123' },
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
              },
            ],
          },
        }),
    };
  }
  return { default: MockStripe };
});

describe('stripe webhook handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (req: any, res: any) => Promise<void>;
  let mockRes: { statusCode: number; headers: Record<string, string>; body: string; setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockRes = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader: vi.fn((k: string, v: string) => { mockRes.headers[k] = v; }),
      end: vi.fn((b?: string) => { mockRes.body = b || ''; }),
    };

    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    vi.resetModules();
    const mod = await import('../../../api/stripe/webhook');
    handler = mod.default;
  });

  function makeReq(method: string, body: string, signature = 'valid') {
    return {
      method,
      headers: new Headers({
        'stripe-signature': signature,
        'content-type': 'application/json',
      }),
      body,
    };
  }

  it('rejects non-POST requests', async () => {
    await handler(makeReq('GET', ''), mockRes);
    expect(mockRes.statusCode).toBe(405);
  });

  it('rejects missing stripe-signature', async () => {
    const req = {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{}',
    };
    await handler(req, mockRes);
    expect(mockRes.statusCode).toBe(400);
    expect(mockRes.body).toContain('stripe-signature');
  });

  it('rejects invalid signature', async () => {
    const req = makeReq('POST', '{}', 'invalid');
    await handler(req, mockRes);
    expect(mockRes.statusCode).toBe(400);
    expect(mockRes.body).toContain('Signature verification failed');
  });

  it('handles checkout.session.completed', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user-123',
          customer: 'cus_123',
          subscription: 'sub_123',
        },
      },
    };
    await handler(makeReq('POST', JSON.stringify(event)), mockRes);
    expect(mockRes.statusCode).toBe(200);
    expect(JSON.parse(mockRes.body)).toEqual({ received: true });
  });

  it('handles customer.subscription.updated', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [{
              price: { id: 'price_123' },
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            }],
          },
        },
      },
    };
    await handler(makeReq('POST', JSON.stringify(event)), mockRes);
    expect(mockRes.statusCode).toBe(200);
  });

  it('handles customer.subscription.deleted', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: { id: 'sub_123' },
      },
    };
    await handler(makeReq('POST', JSON.stringify(event)), mockRes);
    expect(mockRes.statusCode).toBe(200);
  });

  it('handles invoice.payment_failed', async () => {
    const event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          parent: {
            subscription_details: { subscription: 'sub_123' },
          },
        },
      },
    };
    await handler(makeReq('POST', JSON.stringify(event)), mockRes);
    expect(mockRes.statusCode).toBe(200);
  });
});

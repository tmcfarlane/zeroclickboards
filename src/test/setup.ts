import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Provide dummy Supabase env vars so the client module doesn't throw on import
if (!import.meta.env.VITE_SUPABASE_URL) {
  (import.meta.env as Record<string, string>).VITE_SUPABASE_URL = 'https://test.supabase.co';
}
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY = 'test-anon-key';
}

// Mock @supabase/supabase-js so no real network calls are made
vi.mock('@supabase/supabase-js', () => {
  const mockChannel = {
    on: () => mockChannel,
    subscribe: () => mockChannel,
    unsubscribe: vi.fn(),
  };

  const mockFrom = () => ({
    select: () => ({
      eq: () => ({
        order: () => ({ data: [], error: null }),
        in: () => ({ data: [], error: null }),
        limit: () => ({ maybeSingle: () => ({ data: null, error: null }) }),
        data: [],
        error: null,
      }),
      data: [],
      error: null,
    }),
    insert: () => ({ data: null, error: null }),
    update: () => ({
      eq: () => ({
        eq: () => ({ data: null, error: null, then: (fn: (v: { error: null }) => void) => fn({ error: null }) }),
        then: (fn: (v: { error: null }) => void) => fn({ error: null }),
      }),
      then: (fn: (v: { error: null }) => void) => fn({ error: null }),
    }),
    upsert: () => ({ data: null, error: null, then: (fn: (v: { error: null }) => void) => fn({ error: null }) }),
    delete: () => ({
      eq: () => ({
        eq: () => ({ data: null, error: null, then: (fn: (v: { error: null }) => void) => fn({ error: null }) }),
        then: (fn: (v: { error: null }) => void) => fn({ error: null }),
      }),
    }),
  });

  const mockClient = {
    from: mockFrom,
    channel: () => mockChannel,
    removeChannel: vi.fn(),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signInWithOAuth: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
      signUp: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
  };

  return {
    createClient: () => mockClient,
  };
});

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  Toaster: () => null,
}));

// Mock window.matchMedia (not provided by jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage for tests that need it
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

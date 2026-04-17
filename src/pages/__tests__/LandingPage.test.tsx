import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false, userId: null, user: null }),
}));

vi.mock('@/components/auth/SignInModal', () => ({
  SignInModal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/FallingCardsShower', () => ({
  FallingCardsShower: () => null,
}));

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(),
    from: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    registerPlugin: vi.fn(),
    timeline: () => ({
      to: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      play: vi.fn(),
      kill: vi.fn(),
    }),
  },
  ScrollTrigger: {
    create: vi.fn(),
    refresh: vi.fn(),
    getAll: () => [],
    kill: vi.fn(),
  },
}));

vi.mock('matter-js', () => ({
  Engine: { create: vi.fn() },
  World: { add: vi.fn() },
  Bodies: { rectangle: vi.fn() },
  Render: { create: vi.fn(), run: vi.fn() },
  Runner: { create: vi.fn(), run: vi.fn() },
}));

describe('LandingPage', () => {
  it('renders without crashing and shows heading', async () => {
    const { LandingPage } = await import('../LandingPage');

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Get Started — It's Free")).toBeInTheDocument();
  });
});

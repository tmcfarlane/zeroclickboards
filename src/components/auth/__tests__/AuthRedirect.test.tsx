import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthRedirect } from '../AuthRedirect';

const mockUseAuth = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

function renderWithRouter(ui: React.ReactElement, initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
  );
}

describe('AuthRedirect', () => {
  it('shows loading state when auth is not loaded', () => {
    mockUseAuth.mockReturnValue({ isLoaded: false, isSignedIn: false });

    renderWithRouter(
      <AuthRedirect>
        <div>Child</div>
      </AuthRedirect>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
  });

  it('renders children when auth loaded and no requireAuth', () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });

    renderWithRouter(
      <AuthRedirect>
        <div>Public Content</div>
      </AuthRedirect>
    );

    expect(screen.getByText('Public Content')).toBeInTheDocument();
  });

  it('redirects to / when requireAuth and not signed in', () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });

    renderWithRouter(
      <AuthRedirect requireAuth>
        <div>Protected</div>
      </AuthRedirect>,
      ['/app']
    );

    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('renders children when requireAuth and signed in', () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });

    renderWithRouter(
      <AuthRedirect requireAuth>
        <div>Protected Content</div>
      </AuthRedirect>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects signed-in user from landing to /app', () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });

    renderWithRouter(
      <AuthRedirect>
        <div>Landing</div>
      </AuthRedirect>
    );

    expect(screen.queryByText('Landing')).not.toBeInTheDocument();
  });
});

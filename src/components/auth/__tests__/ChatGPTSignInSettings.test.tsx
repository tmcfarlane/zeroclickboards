import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTSignInSettings } from '../ChatGPTSignInSettings';
import { AccountPage } from '@/pages/AccountPage';

const state = vi.hoisted(() => ({
  isChatGPTSignInEnabled: true,
  isSignedIn: true,
  user: { id: 'first-account', email: 'first@example.invalid', user_metadata: {}, identities: [] as Array<{ provider: string }> },
  linkChatGPTIdentity: vi.fn(),
  signInWithChatGPT: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../AuthProvider', () => ({ useAuthContext: () => ({ ...state, session: null }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ hasSubscription: false, subscription: null, isLoading: false }) }));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));
vi.mock('@/components/connectors/ConnectorSettings', () => ({ ConnectorSettings: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.isChatGPTSignInEnabled = true;
  state.isSignedIn = true;
  state.user = { id: 'first-account', email: 'first@example.invalid', user_metadata: {}, identities: [] };
  state.linkChatGPTIdentity.mockResolvedValue({ error: null });
});

describe('ChatGPTSignInSettings', () => {
  it('hides the entire linking section when disabled', () => {
    state.isChatGPTSignInEnabled = false;
    const { container } = render(<ChatGPTSignInSettings />);
    expect(container).toBeEmptyDOMElement();
    expect(state.linkChatGPTIdentity).not.toHaveBeenCalled();
  });

  it('does not offer account linking to signed-out users', () => {
    state.isSignedIn = false;
    const { container } = render(<ChatGPTSignInSettings />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts explicit identity linking while preserving the existing account', async () => {
    const user = userEvent.setup();
    render(<ChatGPTSignInSettings />);
    expect(screen.getByRole('region', { name: 'ChatGPT sign-in' })).toHaveTextContent('keep your existing boards');
    expect(state.linkChatGPTIdentity).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Link ChatGPT account' }));
    expect(state.linkChatGPTIdentity).toHaveBeenCalledTimes(1);
    expect(state.signInWithChatGPT).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Continue in ChatGPT to finish linking');
    expect(screen.queryByText('ChatGPT account linked')).not.toBeInTheDocument();
  });

  it('allows one pending link attempt and presents returned errors before retry', async () => {
    let finish!: (result: { error: string | null }) => void;
    state.linkChatGPTIdentity.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<ChatGPTSignInSettings />);
    const link = screen.getByRole('button', { name: 'Link ChatGPT account' });
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(state.linkChatGPTIdentity).toHaveBeenCalledTimes(1);
    expect(link).toBeDisabled();
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Opening ChatGPT');
    await act(async () => finish({ error: 'This ChatGPT identity is already linked elsewhere.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('already linked elsewhere');
    expect(link).toBeEnabled();
    await user.click(link);
    expect(state.linkChatGPTIdentity).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('handles a thrown link failure without claiming that the account was linked', async () => {
    state.linkChatGPTIdentity.mockRejectedValue(new Error('Network failed'));
    const user = userEvent.setup();
    render(<ChatGPTSignInSettings />);
    await user.click(screen.getByRole('button', { name: 'Link ChatGPT account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start account linking. Try again.');
    expect(screen.getByRole('button', { name: 'Link ChatGPT account' })).toBeEnabled();
    expect(screen.queryByText('ChatGPT account linked')).not.toBeInTheDocument();
  });

  it('shows linked status only for the verified custom:chatgpt identity provider', () => {
    state.user.identities = [{ provider: 'google' }, { provider: 'chatgpt' }];
    const { rerender } = render(<ChatGPTSignInSettings />);
    expect(screen.getByRole('button', { name: 'Link ChatGPT account' })).toBeVisible();
    state.user = { ...state.user, identities: [{ provider: 'custom:chatgpt' }] };
    rerender(<ChatGPTSignInSettings />);
    expect(screen.getByRole('status')).toHaveTextContent('ChatGPT account linked');
    expect(screen.queryByRole('button', { name: 'Link ChatGPT account' })).not.toBeInTheDocument();
    expect(state.linkChatGPTIdentity).not.toHaveBeenCalled();
  });

  it('remounts account settings for a replacement user and ignores the old pending result', async () => {
    let finish!: (result: { error: string | null }) => void;
    state.linkChatGPTIdentity.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    const { rerender } = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Link ChatGPT account' }));
    state.user = { id: 'second-account', email: 'second@example.invalid', user_metadata: {}, identities: [] };
    rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Link ChatGPT account' })).toBeEnabled();
    expect(screen.queryByText('Opening ChatGPT…')).not.toBeInTheDocument();
    await act(async () => finish({ error: 'Private first-account error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('second@example.invalid')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Link ChatGPT account' }));
    expect(state.linkChatGPTIdentity).toHaveBeenCalledTimes(2);
    expect(state.signInWithChatGPT).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInModal } from '../SignInModal';

const mocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithChatGPT: vi.fn(),
  isChatGPTSignInEnabled: false,
}));

vi.mock('../AuthProvider', () => ({
  useAuthContext: () => ({
    signInWithEmail: mocks.signInWithEmail,
    signUpWithEmail: mocks.signUpWithEmail,
    signInWithGoogle: mocks.signInWithGoogle,
    signInWithChatGPT: mocks.signInWithChatGPT,
    isChatGPTSignInEnabled: mocks.isChatGPTSignInEnabled,
  }),
}));

function renderModal() {
  const onOpenChange = vi.fn();
  const view = render(<SignInModal isOpen onOpenChange={onOpenChange} />);
  return { ...view, onOpenChange, user: userEvent.setup() };
}

describe('SignInModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isChatGPTSignInEnabled = false;
    mocks.signInWithEmail.mockResolvedValue({ error: null });
    mocks.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
    mocks.signInWithGoogle.mockResolvedValue({ error: null });
    mocks.signInWithChatGPT.mockResolvedValue({ error: null });
  });

  it('keeps the submit button disabled until email and password are entered', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
  });

  it('allows sign-in with a short (pre-existing) password — no 8-char lockout', async () => {
    const { user } = renderModal();
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), '123456'); // 6 chars
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  });

  it('submits sign-in via the form and closes on success', async () => {
    const { user, onOpenChange } = renderModal();
    await user.type(screen.getByLabelText('Email'), '  user@example.com  ');
    await user.type(screen.getByLabelText('Password'), 'shortpw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(mocks.signInWithEmail).toHaveBeenCalledWith('user@example.com', 'shortpw');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('submits when pressing Enter in a field (real <form>)', async () => {
    const { user } = renderModal();
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'shortpw{Enter}');
    await waitFor(() => expect(mocks.signInWithEmail).toHaveBeenCalledTimes(1));
  });

  it('enforces the 8-char minimum only on the sign-up tab', async () => {
    const { user } = renderModal();
    await user.click(screen.getByRole('tab', { name: /sign up/i }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), '1234567'); // 7 chars
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), '8'); // now 8 chars
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled();
  });

  it('stays open with a confirmation notice when sign-up needs email verification', async () => {
    mocks.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: true });
    const { user, onOpenChange } = renderModal();
    await user.click(screen.getByRole('tab', { name: /sign up/i }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/check your email/i));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('hides ChatGPT sign-in while it is disabled', () => {
    renderModal();
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(mocks.signInWithChatGPT).not.toHaveBeenCalled();
  });

  it('offers ChatGPT beside Google when enabled and starts only the selected provider', async () => {
    mocks.isChatGPTSignInEnabled = true;
    const { user } = renderModal();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
    expect(mocks.signInWithChatGPT).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
  });

  it.each(['ChatGPT', 'Google'] as const)('keeps %s OAuth errors outside email tabs and email validation', async (provider) => {
    mocks.isChatGPTSignInEnabled = true;
    const signIn = provider === 'ChatGPT' ? mocks.signInWithChatGPT : mocks.signInWithGoogle;
    signIn.mockResolvedValue({ error: `${provider} sign-in could not start.` });
    const { user } = renderModal();
    await user.click(screen.getByRole('tab', { name: 'Sign up' }));
    await user.click(screen.getByRole('button', { name: `Continue with ${provider}` }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`${provider} sign-in could not start.`);
    expect(alert.closest('[role="tabpanel"]')).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('tab', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent(`${provider} sign-in could not start.`);
  });

  it('prevents repeated provider clicks and email submits while ChatGPT sign-in is pending', async () => {
    mocks.isChatGPTSignInEnabled = true;
    let finish!: (result: { error: string | null }) => void;
    mocks.signInWithChatGPT.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { user } = renderModal();
    await user.type(screen.getByLabelText('Email'), 'user@example.invalid');
    await user.type(screen.getByLabelText('Password'), 'password123');
    const chatgpt = screen.getByRole('button', { name: 'Continue with ChatGPT' });
    act(() => {
      chatgpt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      chatgpt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mocks.signInWithChatGPT).toHaveBeenCalledTimes(1);
    expect(chatgpt).toBeDisabled();
    expect(chatgpt).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Sign in$/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), '{Enter}');
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
    await act(async () => finish({ error: 'Try ChatGPT again.' }));
    expect(chatgpt).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Try ChatGPT again.');
  });

  it('recovers from a thrown OAuth failure without leaving sign-in disabled', async () => {
    mocks.isChatGPTSignInEnabled = true;
    mocks.signInWithChatGPT.mockRejectedValue(new Error('Transport failed'));
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start sign-in. Try again.');
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  });

  it('ignores a late OAuth error after the modal is closed and reopened', async () => {
    mocks.isChatGPTSignInEnabled = true;
    let finish!: (result: { error: string | null }) => void;
    mocks.signInWithChatGPT.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { user, rerender, onOpenChange } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
    rerender(<SignInModal isOpen={false} onOpenChange={onOpenChange} />);
    rerender(<SignInModal isOpen onOpenChange={onOpenChange} />);
    await act(async () => finish({ error: 'Old modal error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
    expect(mocks.signInWithChatGPT).toHaveBeenCalledTimes(2);
  });
});

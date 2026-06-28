import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInModal } from '../SignInModal';

const mocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock('../AuthProvider', () => ({
  useAuthContext: () => ({
    signInWithEmail: mocks.signInWithEmail,
    signUpWithEmail: mocks.signUpWithEmail,
    signInWithGoogle: mocks.signInWithGoogle,
  }),
}));

function renderModal() {
  const onOpenChange = vi.fn();
  render(<SignInModal isOpen onOpenChange={onOpenChange} />);
  return { onOpenChange, user: userEvent.setup() };
}

describe('SignInModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithEmail.mockResolvedValue({ error: null });
    mocks.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
    mocks.signInWithGoogle.mockResolvedValue({ error: null });
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
});

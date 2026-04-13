import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Github } from 'lucide-react';
import { UserProfile } from '@/components/auth/UserProfile';
import { SignInModal } from '@/components/auth/SignInModal';

export function PublicHeader() {
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL as string | undefined;

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F0F]/90 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3 max-w-7xl mx-auto">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/logo/logo_color.svg"
              alt="ZeroBoard"
              width={32}
              height={32}
              className="w-8 h-8 drop-shadow-[0_0_8px_rgba(120,252,214,0.3)]"
            />
            <span className="font-semibold text-lg text-[#F2F7F7]">ZeroBoard</span>
          </Link>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/terms" className="text-sm text-[#A8B2B2] hover:text-[#78fcd6] transition-colors">Terms</Link>
            <Link to="/privacy" className="text-sm text-[#A8B2B2] hover:text-[#78fcd6] transition-colors">Privacy</Link>
            <Link to="/feedback" className="text-sm text-[#A8B2B2] hover:text-[#78fcd6] transition-colors">Feedback</Link>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                aria-label="Open GitHub repository"
              >
                <Github className="w-4 h-4 text-[#A8B2B2]" />
              </a>
            )}
            <UserProfile onSignInClick={() => setIsSignInModalOpen(true)} />
          </div>
        </div>
      </header>

      <SignInModal isOpen={isSignInModalOpen} onOpenChange={setIsSignInModalOpen} />
    </>
  );
}

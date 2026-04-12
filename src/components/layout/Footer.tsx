import { Link } from 'react-router-dom';
import { Github } from 'lucide-react';

interface FooterProps {
  variant?: 'full' | 'compact';
}

export function Footer({ variant = 'full' }: FooterProps) {
  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL as string | undefined;

  if (variant === 'compact') {
    return (
      <footer className="bg-[#0B0F0F] border-t border-white/5 py-1 px-4">
        <div className="flex items-center justify-between text-xs text-[#A8B2B2]">
          <span>ZeroBoard</span>
          <div className="flex items-center gap-3">
            <Link to="/terms" className="hover:text-[#78fcd6] transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-[#78fcd6] transition-colors">Privacy</Link>
            <Link to="/feedback" className="hover:text-[#78fcd6] transition-colors">Feedback</Link>
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noreferrer" className="hover:text-[#78fcd6] transition-colors">
                <Github className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-[#0B0F0F] border-t border-white/5 py-6">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-md gradient-cyan flex items-center justify-center">
              <span className="text-[#0B0F0F] font-bold text-xs">Z</span>
            </div>
            <span className="text-sm font-medium text-[#F2F7F7]">ZeroBoard</span>
          </div>

          <div className="flex items-center gap-4 text-sm text-[#A8B2B2]">
            <Link to="/terms" className="hover:text-[#78fcd6] transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-[#78fcd6] transition-colors">Privacy</Link>
            <Link to="/feedback" className="hover:text-[#78fcd6] transition-colors">Feedback</Link>
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noreferrer" className="hover:text-[#78fcd6] transition-colors flex items-center gap-1">
                <Github className="w-4 h-4" />
                <span>GitHub</span>
              </a>
            )}
          </div>

          <div className="text-xs text-[#A8B2B2]">
            Built by ZeroClickDev &middot; Open Source
          </div>
        </div>
      </div>
    </footer>
  );
}

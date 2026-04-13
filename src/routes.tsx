import { Routes, Route } from 'react-router-dom';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AppShell } from '@/components/layout/AppShell';
import { AuthRedirect } from '@/components/auth/AuthRedirect';
import { LandingPage } from '@/pages/LandingPage';
import { TermsPage } from '@/pages/TermsPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { FeedbackPage } from '@/pages/FeedbackPage';
import { SharedBoardPage } from '@/pages/SharedBoardPage';
import { EmbedBoardPage } from '@/pages/EmbedBoardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AccountPage } from '@/pages/AccountPage';
import { AdminPage } from '@/pages/AdminPage';

export function AppRoutes() {
  return (
    <Routes>
      {/* Public pages with shared header/footer */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<AuthRedirect><LandingPage /></AuthRedirect>} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
      </Route>

      {/* Authenticated app */}
      <Route path="/app" element={<AuthRedirect requireAuth><AppShell /></AuthRedirect>} />
      <Route path="/account" element={<AuthRedirect requireAuth><AccountPage /></AuthRedirect>} />
      <Route path="/admin" element={<AuthRedirect requireAuth><AdminPage /></AuthRedirect>} />

      {/* Shared board (auth-aware, no public layout chrome) */}
      <Route path="/board/:boardId" element={<SharedBoardPage />} />

      {/* Embed (no chrome, no auth) */}
      <Route path="/embed/:boardId" element={<EmbedBoardPage />} />

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

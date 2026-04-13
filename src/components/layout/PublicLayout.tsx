import { Outlet } from 'react-router-dom';
import { PublicHeader } from './PublicHeader';
import { Footer } from './Footer';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] flex flex-col">
      <PublicHeader />
      <main className="flex-1 pt-14">
        <Outlet />
      </main>
      <Footer variant="full" />
    </div>
  );
}

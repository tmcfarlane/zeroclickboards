import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#0B0F0F] flex flex-col items-center justify-center px-6 text-center">
      <p className="text-[9rem] font-black leading-none gradient-cyan select-none">404</p>
      <h1 className="mt-4 text-2xl font-bold text-[#F2F7F7]">Page not found</h1>
      <p className="mt-2 text-[#A8B2B2]">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex items-center justify-center h-11 px-8 gradient-cyan text-[#0B0F0F] font-bold rounded-xl hover:opacity-90 transition-opacity"
      >
        Go Home
      </Link>
    </div>
  );
}

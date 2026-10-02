import { Toaster } from 'sonner';

export function AppToaster() {
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      offset={{ bottom: 80 }}
      toastOptions={{
        style: {
          background: '#111515',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#F2F7F7',
        },
      }}
    />
  );
}

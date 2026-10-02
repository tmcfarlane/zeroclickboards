import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import { AppRoutes } from './routes'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const router = createBrowserRouter([
  { path: '*', element: <ErrorBoundary><AppRoutes /></ErrorBoundary> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          offset={{ bottom: 80 }}
          toastOptions={{ style: { background: '#111515', border: '1px solid rgba(255,255,255,0.1)', color: '#F2F7F7' } }}
        />
        <Analytics />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

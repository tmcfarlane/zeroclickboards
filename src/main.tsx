import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import { AppRoutes } from './routes'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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
        <Analytics />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

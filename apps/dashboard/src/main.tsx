import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'dev';

function AppShell() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Lazy-load Clerk only when needed — avoids loading the SDK in dev mode
const ClerkWrapper = lazy(async () => {
  const [{ ClerkProvider }] = await Promise.all([import('@clerk/clerk-react')]);
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: ({ children }: { children: any }) => (
      <ClerkProvider publishableKey={key}>{children}</ClerkProvider>
    ),
  };
});

function Root() {
  if (authProvider === 'clerk') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>}>
        <ClerkWrapper>
          <AppShell />
        </ClerkWrapper>
      </Suspense>
    );
  }

  return <AppShell />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

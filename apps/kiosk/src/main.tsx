import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './i18n';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'dev';

const ClerkWrapper = lazy(async () => {
  const { ClerkProvider } = await import('@clerk/clerk-react');
  return {
    default: ({ children }: { children: React.ReactNode }) => (
      <ClerkProvider publishableKey={clerkPubKey!}>{children}</ClerkProvider>
    ),
  };
});

function Root() {
  const inner = (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  );

  if (authProvider === 'clerk' && clerkPubKey) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-gray-900" />}>
        <ClerkWrapper>{inner}</ClerkWrapper>
      </Suspense>
    );
  }
  return inner;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

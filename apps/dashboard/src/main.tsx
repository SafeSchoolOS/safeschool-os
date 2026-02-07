import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { AuthProvider } from './hooks/useAuth';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'dev';

function Root() {
  const inner = (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );

  // Wrap with ClerkProvider only in clerk mode
  if (authProvider === 'clerk' && clerkPubKey) {
    return <ClerkProvider publishableKey={clerkPubKey}>{inner}</ClerkProvider>;
  }

  return inner;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

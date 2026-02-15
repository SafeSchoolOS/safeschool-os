import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { WelcomePage } from './pages/WelcomePage';
import { useKioskMode } from './hooks/useKioskMode';

const CheckInPage = lazy(() => import('./pages/CheckInPage').then(m => ({ default: m.CheckInPage })));
const ScreeningPage = lazy(() => import('./pages/ScreeningPage').then(m => ({ default: m.ScreeningPage })));
const ConfirmedPage = lazy(() => import('./pages/ConfirmedPage').then(m => ({ default: m.ConfirmedPage })));
const CheckOutPage = lazy(() => import('./pages/CheckOutPage').then(m => ({ default: m.CheckOutPage })));
const DeniedPage = lazy(() => import('./pages/DeniedPage').then(m => ({ default: m.DeniedPage })));

function PageLoader() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function App() {
  useKioskMode();

  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/check-in" element={<Suspense fallback={<PageLoader />}><CheckInPage /></Suspense>} />
      <Route path="/screening/:id" element={<Suspense fallback={<PageLoader />}><ScreeningPage /></Suspense>} />
      <Route path="/confirmed/:id" element={<Suspense fallback={<PageLoader />}><ConfirmedPage /></Suspense>} />
      <Route path="/check-out" element={<Suspense fallback={<PageLoader />}><CheckOutPage /></Suspense>} />
      <Route path="/denied" element={<Suspense fallback={<PageLoader />}><DeniedPage /></Suspense>} />
    </Routes>
  );
}

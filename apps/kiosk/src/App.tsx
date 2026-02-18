import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { WelcomePage } from './pages/WelcomePage';
import { useKioskMode } from './hooks/useKioskMode';
import { useOnlineStatus } from './hooks/useOnlineStatus';

const CheckInPage = lazy(() => import('./pages/CheckInPage').then(m => ({ default: m.CheckInPage })));
const ScreeningPage = lazy(() => import('./pages/ScreeningPage').then(m => ({ default: m.ScreeningPage })));
const ConfirmedPage = lazy(() => import('./pages/ConfirmedPage').then(m => ({ default: m.ConfirmedPage })));
const CheckOutPage = lazy(() => import('./pages/CheckOutPage').then(m => ({ default: m.CheckOutPage })));
const DeniedPage = lazy(() => import('./pages/DeniedPage').then(m => ({ default: m.DeniedPage })));
const QrScanPage = lazy(() => import('./pages/QrScanPage').then(m => ({ default: m.QrScanPage })));
const GroupCheckInPage = lazy(() => import('./pages/GroupCheckInPage').then(m => ({ default: m.GroupCheckInPage })));

function PageLoader() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function SyncStatusBar() {
  const { isOnline, pendingSyncCount } = useOnlineStatus();

  if (isOnline && pendingSyncCount === 0) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-center text-sm font-medium ${
      isOnline
        ? 'bg-yellow-600 text-white'
        : 'bg-red-700 text-white'
    }`}>
      {!isOnline && 'Offline Mode — Check-ins will be synced when connection is restored'}
      {isOnline && pendingSyncCount > 0 && `Syncing ${pendingSyncCount} pending check-in${pendingSyncCount > 1 ? 's' : ''}...`}
    </div>
  );
}

export function App() {
  useKioskMode();

  return (
    <>
      <SyncStatusBar />
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/check-in" element={<Suspense fallback={<PageLoader />}><CheckInPage /></Suspense>} />
        <Route path="/screening/:id" element={<Suspense fallback={<PageLoader />}><ScreeningPage /></Suspense>} />
        <Route path="/confirmed/:id" element={<Suspense fallback={<PageLoader />}><ConfirmedPage /></Suspense>} />
        <Route path="/check-out" element={<Suspense fallback={<PageLoader />}><CheckOutPage /></Suspense>} />
        <Route path="/denied" element={<Suspense fallback={<PageLoader />}><DeniedPage /></Suspense>} />
        <Route path="/scan" element={<Suspense fallback={<PageLoader />}><QrScanPage /></Suspense>} />
        <Route path="/group" element={<Suspense fallback={<PageLoader />}><GroupCheckInPage /></Suspense>} />
      </Routes>
    </>
  );
}

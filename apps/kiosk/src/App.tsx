import { Routes, Route } from 'react-router-dom';
import { WelcomePage } from './pages/WelcomePage';
import { CheckInPage } from './pages/CheckInPage';
import { ScreeningPage } from './pages/ScreeningPage';
import { BadgePage } from './pages/BadgePage';
import { CheckOutPage } from './pages/CheckOutPage';
import { DeniedPage } from './pages/DeniedPage';
import { GuardLoginPage } from './pages/GuardLoginPage';
import { GuardConsolePage } from './pages/GuardConsolePage';

export function App() {
  return (
    <Routes>
      {/* BadgeKiosk — Visitor Management (FREE) */}
      <Route path="/" element={<WelcomePage />} />
      <Route path="/check-in" element={<CheckInPage />} />
      <Route path="/screening/:id" element={<ScreeningPage />} />
      <Route path="/badge/:id" element={<BadgePage />} />
      <Route path="/check-out" element={<CheckOutPage />} />
      <Route path="/denied" element={<DeniedPage />} />

      {/* BadgeKiosk — Guard Console (PAID) */}
      <Route path="/guard-login" element={<GuardLoginPage />} />
      <Route path="/guard" element={<GuardConsolePage />} />
    </Routes>
  );
}

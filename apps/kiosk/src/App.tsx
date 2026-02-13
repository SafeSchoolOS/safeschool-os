import { Routes, Route } from 'react-router-dom';
import { WelcomePage } from './pages/WelcomePage';
import { CheckInPage } from './pages/CheckInPage';
import { ScreeningPage } from './pages/ScreeningPage';
import { ConfirmedPage } from './pages/ConfirmedPage';
import { CheckOutPage } from './pages/CheckOutPage';
import { DeniedPage } from './pages/DeniedPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/check-in" element={<CheckInPage />} />
      <Route path="/screening/:id" element={<ScreeningPage />} />
      <Route path="/confirmed/:id" element={<ConfirmedPage />} />
      <Route path="/check-out" element={<CheckOutPage />} />
      <Route path="/denied" element={<DeniedPage />} />
    </Routes>
  );
}

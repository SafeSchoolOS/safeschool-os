import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { CommandCenter } from './pages/CommandCenter';
import { VisitorsPage } from './pages/VisitorsPage';
import { TransportationPage } from './pages/TransportationPage';
import { ThreatAssessmentPage } from './pages/ThreatAssessmentPage';
import { SocialMediaPage } from './pages/SocialMediaPage';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading SafeSchool OS...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={user ? <CommandCenter /> : <Navigate to="/login" />} />
      <Route path="/visitors" element={user ? <VisitorsPage /> : <Navigate to="/login" />} />
      <Route path="/transportation" element={user ? <TransportationPage /> : <Navigate to="/login" />} />
      <Route path="/threat-assessment" element={user ? <ThreatAssessmentPage /> : <Navigate to="/login" />} />
      <Route path="/social-media" element={user ? <SocialMediaPage /> : <Navigate to="/login" />} />
    </Routes>
  );
}

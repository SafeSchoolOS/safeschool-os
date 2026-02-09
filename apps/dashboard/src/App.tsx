import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { CommandCenter } from './pages/CommandCenter';
import { VisitorsPage } from './pages/VisitorsPage';
import { TransportationPage } from './pages/TransportationPage';
import { ThreatAssessmentPage } from './pages/ThreatAssessmentPage';
import { SocialMediaPage } from './pages/SocialMediaPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { DrillsPage } from './pages/DrillsPage';
import { ReunificationPage } from './pages/ReunificationPage';
import { GrantsPage } from './pages/GrantsPage';
import { BadgeKioskPage } from './pages/BadgeKioskPage';
import { FloorPlanPage } from './pages/FloorPlanPage';
import { ReportsPage } from './pages/ReportsPage';
import { OnboardingPage } from './pages/OnboardingPage';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-gray-400 text-sm">Loading SafeSchool OS...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" />} />
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<ErrorBoundary><CommandCenter /></ErrorBoundary>} />
        <Route path="/visitors" element={<ErrorBoundary><VisitorsPage /></ErrorBoundary>} />
        <Route path="/transportation" element={<ErrorBoundary><TransportationPage /></ErrorBoundary>} />
        <Route path="/threat-assessment" element={<ErrorBoundary><ThreatAssessmentPage /></ErrorBoundary>} />
        <Route path="/social-media" element={<ErrorBoundary><SocialMediaPage /></ErrorBoundary>} />
        <Route path="/drills" element={<ErrorBoundary><DrillsPage /></ErrorBoundary>} />
        <Route path="/reunification" element={<ErrorBoundary><ReunificationPage /></ErrorBoundary>} />
        <Route path="/grants" element={<ErrorBoundary><GrantsPage /></ErrorBoundary>} />
        <Route path="/audit-log" element={<ErrorBoundary><AuditLogPage /></ErrorBoundary>} />
        <Route path="/badgekiosk" element={<ErrorBoundary><BadgeKioskPage /></ErrorBoundary>} />
        <Route path="/floor-plan" element={<ErrorBoundary><FloorPlanPage /></ErrorBoundary>} />
        <Route path="/reports" element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
        <Route path="/onboarding" element={<ErrorBoundary><OnboardingPage /></ErrorBoundary>} />
      </Route>
    </Routes>
  );
}

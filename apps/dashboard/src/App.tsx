import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';

// Lazy-load all page routes for code splitting (~38% bundle reduction)
const CommandCenter = lazy(() => import('./pages/CommandCenter').then(m => ({ default: m.CommandCenter })));
const VisitorsPage = lazy(() => import('./pages/VisitorsPage').then(m => ({ default: m.VisitorsPage })));
const TransportationPage = lazy(() => import('./pages/TransportationPage').then(m => ({ default: m.TransportationPage })));
const ThreatAssessmentPage = lazy(() => import('./pages/ThreatAssessmentPage').then(m => ({ default: m.ThreatAssessmentPage })));
const SocialMediaPage = lazy(() => import('./pages/SocialMediaPage').then(m => ({ default: m.SocialMediaPage })));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const DrillsPage = lazy(() => import('./pages/DrillsPage').then(m => ({ default: m.DrillsPage })));
const ReunificationPage = lazy(() => import('./pages/ReunificationPage').then(m => ({ default: m.ReunificationPage })));
const GrantsPage = lazy(() => import('./pages/GrantsPage').then(m => ({ default: m.GrantsPage })));
const FloorPlanPage = lazy(() => import('./pages/FloorPlanPage').then(m => ({ default: m.FloorPlanPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const CompliancePage = lazy(() => import('./pages/CompliancePage').then(m => ({ default: m.CompliancePage })));
const ParentPortalPage = lazy(() => import('./pages/ParentPortalPage').then(m => ({ default: m.ParentPortalPage })));
const EscalationPage = lazy(() => import('./pages/EscalationPage').then(m => ({ default: m.EscalationPage })));
const FleetPage = lazy(() => import('./pages/FleetPage').then(m => ({ default: m.FleetPage })));
const CardholderPage = lazy(() => import('./pages/CardholderPage').then(m => ({ default: m.CardholderPage })));
const StudentPage = lazy(() => import('./pages/StudentPage').then(m => ({ default: m.StudentPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })));
const BadgeKioskSettingsPage = lazy(() => import('./pages/BadgeKioskSettingsPage').then(m => ({ default: m.BadgeKioskSettingsPage })));
const AccessAnalyticsPage = lazy(() => import('./pages/AccessAnalyticsPage').then(m => ({ default: m.AccessAnalyticsPage })));
const BadgeGuardSettingsPage = lazy(() => import('./pages/BadgeGuardSettingsPage').then(m => ({ default: m.BadgeGuardSettingsPage })));
const VisitorSettingsPage = lazy(() => import('./pages/VisitorSettingsPage').then(m => ({ default: m.VisitorSettingsPage })));
const VisitorAnalyticsPage = lazy(() => import('./pages/VisitorAnalyticsPage').then(m => ({ default: m.VisitorAnalyticsPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

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

  const isParent = user.role === 'PARENT';

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={isParent ? '/parent' : '/'} />} />
      <Route element={<DashboardLayout />}>
        <Route path="/" element={isParent ? <Navigate to="/parent" replace /> : <LazyRoute><CommandCenter /></LazyRoute>} />
        <Route path="/parent" element={<LazyRoute><ParentPortalPage /></LazyRoute>} />
        <Route path="/visitors" element={<LazyRoute><VisitorsPage /></LazyRoute>} />
        <Route path="/transportation" element={<LazyRoute><TransportationPage /></LazyRoute>} />
        <Route path="/threat-assessment" element={<LazyRoute><ThreatAssessmentPage /></LazyRoute>} />
        <Route path="/social-media" element={<LazyRoute><SocialMediaPage /></LazyRoute>} />
        <Route path="/drills" element={<LazyRoute><DrillsPage /></LazyRoute>} />
        <Route path="/reunification" element={<LazyRoute><ReunificationPage /></LazyRoute>} />
        <Route path="/grants" element={<LazyRoute><GrantsPage /></LazyRoute>} />
        <Route path="/audit-log" element={<LazyRoute><AuditLogPage /></LazyRoute>} />
        <Route path="/floor-plan" element={<LazyRoute><FloorPlanPage /></LazyRoute>} />
        <Route path="/reports" element={<LazyRoute><ReportsPage /></LazyRoute>} />
        <Route path="/compliance" element={<LazyRoute><CompliancePage /></LazyRoute>} />
        <Route path="/escalation" element={<LazyRoute><EscalationPage /></LazyRoute>} />
        <Route path="/cardholders" element={<LazyRoute><CardholderPage /></LazyRoute>} />
        <Route path="/students" element={<LazyRoute><StudentPage /></LazyRoute>} />
        <Route path="/fleet" element={<LazyRoute><FleetPage /></LazyRoute>} />
        <Route path="/onboarding" element={<LazyRoute><OnboardingPage /></LazyRoute>} />
        <Route path="/users" element={<LazyRoute><UsersPage /></LazyRoute>} />
        <Route path="/settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
        <Route path="/badgekiosk" element={<LazyRoute><BadgeKioskSettingsPage /></LazyRoute>} />
        <Route path="/access-analytics" element={<LazyRoute><AccessAnalyticsPage /></LazyRoute>} />
        <Route path="/access-analytics/settings" element={<LazyRoute><BadgeGuardSettingsPage /></LazyRoute>} />
        <Route path="/visitor-settings" element={<LazyRoute><VisitorSettingsPage /></LazyRoute>} />
        <Route path="/visitor-analytics" element={<LazyRoute><VisitorAnalyticsPage /></LazyRoute>} />
      </Route>
    </Routes>
  );
}

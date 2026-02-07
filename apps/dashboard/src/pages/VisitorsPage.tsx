import { useAuth } from '../hooks/useAuth';
import { VisitorList } from '../components/visitors/VisitorList';
import { VisitorCheckInForm } from '../components/visitors/VisitorCheckInForm';
import { useVisitors } from '../api/visitors';

export function VisitorsPage() {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];
  const { data: allVisitors } = useVisitors(siteId);

  const todayCount = allVisitors?.length || 0;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-gray-400 hover:text-white transition-colors">&larr; Command Center</a>
          <h1 className="text-xl font-bold">Visitor Management</h1>
        </div>
        <span className="text-sm text-gray-400">{todayCount} visitor records</span>
      </header>

      <div className="p-6 grid grid-cols-12 gap-6">
        <div className="col-span-8">
          <VisitorList />
        </div>
        <div className="col-span-4">
          <VisitorCheckInForm />
        </div>
      </div>
    </div>
  );
}

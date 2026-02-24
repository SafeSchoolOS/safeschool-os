import { useDemoRequestStats } from '../api/admin';
import { useAllSites } from '../api/admin';
import { useAllUsers } from '../api/admin';
import { useOrganizations } from '../api/admin';
import { Link } from 'react-router-dom';

export function AdminSettingsPage() {
  const { data: stats } = useDemoRequestStats();
  const { data: sitesData } = useAllSites();
  const { data: usersData } = useAllUsers();
  const { data: orgs } = useOrganizations();

  const cards = [
    { label: 'Organizations', value: orgs?.length ?? '-', path: '/admin/organizations', color: 'bg-blue-600' },
    { label: 'Sites', value: sitesData?.total ?? '-', path: '/admin/sites', color: 'bg-green-600' },
    { label: 'Users', value: usersData?.total ?? '-', path: '/admin/users', color: 'bg-purple-600' },
    { label: 'Pending Requests', value: stats?.pending ?? '-', path: '/admin/requests', color: 'bg-yellow-600' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Platform Overview</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.path} className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition-colors">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${c.color} mb-3`}>
              <span className="text-white font-bold text-lg">{typeof c.value === 'number' ? c.value : '-'}</span>
            </div>
            <div className="text-2xl font-bold text-white">{c.value}</div>
            <div className="text-gray-400 text-sm mt-1">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link to="/admin/requests" className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">Review access requests</Link>
          <Link to="/admin/organizations" className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">Manage organizations</Link>
          <Link to="/admin/sites" className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">Manage all sites</Link>
          <Link to="/admin/users" className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">Manage all users</Link>
          <Link to="/onboarding" className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">New site setup wizard</Link>
          <Link to="/users" className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">Manage site users</Link>
        </div>
      </div>
    </div>
  );
}

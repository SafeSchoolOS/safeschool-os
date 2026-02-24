import { useState } from 'react';
import { useAllUsers } from '../api/admin';

const ROLES = ['', 'SUPER_ADMIN', 'SITE_ADMIN', 'OPERATOR', 'TEACHER', 'FIRST_RESPONDER', 'PARENT'];

export function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [role, setRole] = useState('');
  const { data, isLoading } = useAllUsers({ search: debouncedSearch || undefined, role: role || undefined });

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__userSearch);
    (window as any).__userSearch = setTimeout(() => setDebouncedSearch(val), 300);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">All Users</h1>

      <div className="flex gap-4">
        <input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by name or email..." className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white">
          <option value="">All roles</option>
          {ROLES.filter(Boolean).map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              {['Name', 'Email', 'Role', 'Sites', 'Active', 'Created'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : !data?.users.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
            ) : data.users.map((u: any) => (
              <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="px-4 py-3 text-white font-medium">{u.name}</td>
                <td className="px-4 py-3 text-gray-300">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${u.role === 'SUPER_ADMIN' ? 'bg-purple-600' : u.role === 'SITE_ADMIN' ? 'bg-blue-600' : 'bg-gray-600'} text-white`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300 text-sm">{u.sites?.map((s: any) => s.name).join(', ') || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`w-2 h-2 rounded-full inline-block ${u.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <div className="text-gray-500 text-sm">{data.total} total users</div>}
    </div>
  );
}

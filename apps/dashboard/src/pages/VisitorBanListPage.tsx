import { useState } from 'react';
import { useVisitorBans, useCreateVisitorBan, useDeleteVisitorBan, useUpdateVisitorBan } from '../api/visitorBans';

export function VisitorBanListPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', reason: '', notes: '', expiresAt: '' });
  const { data: bans, isLoading } = useVisitorBans({ q: search || undefined });
  const createBan = useCreateVisitorBan();
  const deleteBan = useDeleteVisitorBan();
  const updateBan = useUpdateVisitorBan();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createBan.mutateAsync({
      ...form,
      expiresAt: form.expiresAt || undefined,
    });
    setForm({ firstName: '', lastName: '', reason: '', notes: '', expiresAt: '' });
    setShowForm(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Visitor Ban List</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500">Manage banned visitors and watchlist entries</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
          {showForm ? 'Cancel' : 'Add to Ban List'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="dark:bg-gray-800 bg-white rounded-lg p-6 space-y-4 border dark:border-gray-700 border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name</label>
              <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name</label>
              <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} required className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Expires At (optional)</label>
              <input type="datetime-local" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes (optional)</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
          </div>
          <button type="submit" disabled={createBan.isPending} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50">
            {createBan.isPending ? 'Adding...' : 'Add to Ban List'}
          </button>
        </form>
      )}

      {/* Search */}
      <div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="w-full max-w-sm px-3 py-2 rounded-lg dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 dark:text-gray-400 text-gray-500">Loading ban list...</div>
      ) : (
        <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="dark:bg-gray-700/50 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Banned At</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Banned By</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
              {(bans || []).map((ban: any) => (
                <tr key={ban.id} className="dark:hover:bg-gray-700/30 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{ban.firstName} {ban.lastName}</td>
                  <td className="px-4 py-3">{ban.reason}</td>
                  <td className="px-4 py-3">{new Date(ban.bannedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{ban.expiresAt ? new Date(ban.expiresAt).toLocaleDateString() : 'Never'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${ban.isActive ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {ban.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 dark:text-gray-400 text-gray-500">{ban.bannedBy?.name}</td>
                  <td className="px-4 py-3 flex gap-2">
                    {ban.isActive && (
                      <button onClick={() => updateBan.mutate({ id: ban.id, isActive: false })} className="text-yellow-400 hover:text-yellow-300 text-xs">Deactivate</button>
                    )}
                    <button onClick={() => deleteBan.mutate(ban.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
                  </td>
                </tr>
              ))}
              {(!bans || bans.length === 0) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center dark:text-gray-500 text-gray-400">No banned visitors</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

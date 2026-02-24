import { useState } from 'react';
import { useAllSites, useCreateSite, useUpdateSite, useDeleteSite, useOrganizations, type AdminSite } from '../api/admin';

export function AdminSitesPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { data, isLoading } = useAllSites(debouncedSearch);
  const { data: orgs } = useOrganizations();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const [editing, setEditing] = useState<AdminSite | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '', zip: '', organizationId: '', district: '' });

  const resetForm = () => { setForm({ name: '', address: '', city: '', state: '', zip: '', organizationId: '', district: '' }); setEditing(null); setCreating(false); };

  const openEdit = (site: AdminSite) => {
    setForm({ name: site.name, address: site.address, city: site.city, state: site.state, zip: site.zip, organizationId: site.organizationId || '', district: site.district });
    setEditing(site);
  };

  const handleSave = async () => {
    const data = { ...form, organizationId: form.organizationId || null };
    if (editing) {
      await updateSite.mutateAsync({ id: editing.id, ...data });
    } else {
      await createSite.mutateAsync(data);
    }
    resetForm();
  };

  const handleDelete = (site: AdminSite) => {
    if (confirm(`Delete site "${site.name}"?`)) deleteSite.mutate(site.id);
  };

  // Simple debounce
  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__siteSearch);
    (window as any).__siteSearch = setTimeout(() => setDebouncedSearch(val), 300);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">All Sites</h1>
        <button onClick={() => { resetForm(); setCreating(true); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">New Site</button>
      </div>

      <input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by name, city, or state..." className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400" />

      {(creating || editing) && (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">{editing ? 'Edit Site' : 'New Site'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="School name" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white">
              <option value="">No organization</option>
              {orgs?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" className="col-span-2 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="ZIP" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="District name" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={handleSave} disabled={!form.name || !form.address || !form.city || !form.state || !form.zip} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg">{editing ? 'Update' : 'Create'}</button>
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              {['Name', 'City', 'State', 'Organization', 'Buildings', 'Users', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : !data?.sites.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No sites found</td></tr>
            ) : data.sites.map((s) => (
              <tr key={s.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                <td className="px-4 py-3 text-gray-300">{s.city}</td>
                <td className="px-4 py-3 text-gray-300">{s.state}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{s.organization?.name || '-'}</td>
                <td className="px-4 py-3 text-gray-300">{s._count.buildings}</td>
                <td className="px-4 py-3 text-gray-300">{s._count.users}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(s)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                    <button onClick={() => handleDelete(s)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <div className="text-gray-500 text-sm">{data.total} total sites</div>}
    </div>
  );
}

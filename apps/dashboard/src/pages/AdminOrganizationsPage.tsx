import { useState } from 'react';
import { useOrganizations, useCreateOrganization, useUpdateOrganization, useDeleteOrganization, type Organization } from '../api/admin';

const ORG_TYPES = ['DISTRICT', 'CHARTER_NETWORK', 'STATE_AGENCY', 'PRIVATE_SYSTEM'];

export function AdminOrganizationsPage() {
  const { data: orgs, isLoading } = useOrganizations();
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const deleteOrg = useDeleteOrganization();
  const [editing, setEditing] = useState<Organization | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', type: 'DISTRICT', address: '', city: '', state: '', zip: '', phone: '', website: '' });

  const resetForm = () => { setForm({ name: '', slug: '', type: 'DISTRICT', address: '', city: '', state: '', zip: '', phone: '', website: '' }); setEditing(null); setCreating(false); };

  const openEdit = (org: Organization) => {
    setForm({ name: org.name, slug: org.slug, type: org.type, address: org.address || '', city: org.city || '', state: org.state || '', zip: org.zip || '', phone: org.phone || '', website: org.website || '' });
    setEditing(org);
    setCreating(false);
  };

  const handleSave = async () => {
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const data = { ...form, slug };
    if (editing) {
      await updateOrg.mutateAsync({ id: editing.id, ...data });
    } else {
      await createOrg.mutateAsync(data);
    }
    resetForm();
  };

  const handleDelete = (org: Organization) => {
    if (confirm(`Delete organization "${org.name}"? This cannot be undone.`)) {
      deleteOrg.mutate(org.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Organizations</h1>
        <button onClick={() => { resetForm(); setCreating(true); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
          New Organization
        </button>
      </div>

      {/* Create/Edit Form */}
      {(creating || editing) && (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">{editing ? 'Edit Organization' : 'New Organization'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Organization name" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white">
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="ZIP" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
            <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="Website" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={handleSave} disabled={!form.name} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg">
              {editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              {['Name', 'Type', 'Location', 'Sites', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : !orgs?.length ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No organizations</td></tr>
            ) : orgs.map((org) => (
              <tr key={org.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="px-4 py-3 text-white font-medium">{org.name}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{org.type.replace('_', ' ')}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{[org.city, org.state].filter(Boolean).join(', ') || '-'}</td>
                <td className="px-4 py-3 text-gray-300">{org._count?.sites ?? '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(org)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                    <button onClick={() => handleDelete(org)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

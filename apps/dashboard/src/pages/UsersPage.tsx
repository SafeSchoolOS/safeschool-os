import { useState } from 'react';
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useResetPassword,
  useDeactivateUser,
  useImportUsers,
  type User,
  type CreateUserPayload,
} from '../api/users';

const ROLES = ['SUPER_ADMIN', 'SITE_ADMIN', 'OPERATOR', 'TEACHER', 'FIRST_RESPONDER', 'PARENT'] as const;

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-500/20 text-purple-400',
  SITE_ADMIN: 'bg-blue-500/20 text-blue-400',
  OPERATOR: 'bg-cyan-500/20 text-cyan-400',
  TEACHER: 'bg-green-500/20 text-green-400',
  FIRST_RESPONDER: 'bg-red-500/20 text-red-400',
  PARENT: 'bg-gray-500/20 text-gray-400',
};

const EMPTY_FORM: CreateUserPayload = { email: '', name: '', role: 'TEACHER', password: '', phone: '' };

const USER_CSV_TEMPLATE = 'email,name,role,phone,password\n';

function downloadTemplate() {
  const blob = new Blob([USER_CSV_TEMPLATE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'user-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvField(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function exportUsersCsv(users: User[]) {
  const headers = ['name', 'email', 'role', 'phone', 'status', 'sites', 'createdAt'];
  const rows = users.map((u) => [
    u.name,
    u.email,
    u.role,
    u.phone || '',
    u.isActive ? 'Active' : 'Inactive',
    u.sites.map((s) => s.name).join('; '),
    u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : '',
  ].map(escapeCsvField).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-export-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function UsersPage() {
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPassword = useResetPassword();
  const deactivateUser = useDeactivateUser();
  const importUsers = useImportUsers();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState<CreateUserPayload>({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; email: string; role: string; phone: string }>({ name: '', email: '', role: '', phone: '' });
  const [resetPwId, setResetPwId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await createUser.mutateAsync(form);
      setForm({ ...EMPTY_FORM });
      setShowAddForm(false);
      setMessage({ type: 'success', text: 'User created successfully' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setEditForm({ name: user.name, email: user.email, role: user.role, phone: user.phone || '' });
    setMessage(null);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setMessage(null);
    try {
      await updateUser.mutateAsync({ id: editingId, ...editForm });
      setEditingId(null);
      setMessage({ type: 'success', text: 'User updated' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwId || !newPassword) return;
    setMessage(null);
    try {
      await resetPassword.mutateAsync({ id: resetPwId, password: newPassword });
      setResetPwId(null);
      setNewPassword('');
      setMessage({ type: 'success', text: 'Password reset successfully' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleDeactivate = async (user: User) => {
    if (!confirm(`Deactivate ${user.name}? They will no longer be able to log in.`)) return;
    setMessage(null);
    try {
      await deactivateUser.mutateAsync(user.id);
      setMessage({ type: 'success', text: `${user.name} deactivated` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleReactivate = async (user: User) => {
    setMessage(null);
    try {
      await updateUser.mutateAsync({ id: user.id, isActive: true });
      setMessage({ type: 'success', text: `${user.name} reactivated` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handlePreview = async () => {
    if (!importFile) return;
    try {
      const result = await importUsers.mutateAsync({ file: importFile, dryRun: true });
      setImportResult(result);
    } catch { /* error shown by mutation */ }
  };

  const handleImport = async () => {
    if (!importFile) return;
    try {
      const result = await importUsers.mutateAsync({ file: importFile, dryRun: false });
      setImportResult(result);
    } catch { /* error shown by mutation */ }
  };

  const activeUsers = users?.filter((u) => u.isActive) || [];
  const inactiveUsers = users?.filter((u) => !u.isActive) || [];

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold dark:text-white text-gray-900">User Management</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            {activeUsers.length} active user{activeUsers.length !== 1 ? 's' : ''}
            {inactiveUsers.length > 0 && `, ${inactiveUsers.length} inactive`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => users && exportUsersCsv(users)}
            disabled={!users || users.length === 0}
            className="px-4 py-2 text-sm font-medium dark:bg-gray-700 bg-gray-200 hover:dark:bg-gray-600 hover:bg-gray-300 dark:text-white text-gray-900 rounded-lg transition-colors disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => { setShowImport(!showImport); setShowAddForm(false); setMessage(null); }}
            className="px-4 py-2 text-sm font-medium dark:bg-gray-700 bg-gray-200 hover:dark:bg-gray-600 hover:bg-gray-300 dark:text-white text-gray-900 rounded-lg transition-colors"
          >
            Import CSV
          </button>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setShowImport(false); setMessage(null); }}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {showAddForm ? 'Cancel' : 'Add User'}
          </button>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div className={`rounded-lg p-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-900/20 border border-green-700 text-green-300'
            : 'bg-red-900/20 border border-red-500 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {/* CSV Import Panel */}
      {showImport && (
        <div className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold dark:text-white text-gray-900">Import Users from CSV</h3>
          <div className="dark:bg-yellow-900/20 bg-yellow-50 dark:border-yellow-700 border-yellow-300 border rounded-lg p-3 text-sm dark:text-yellow-300 text-yellow-700">
            Passwords in CSV must be at least 12 characters. Delete the CSV file after import.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={downloadTemplate}
              className="text-blue-400 hover:text-blue-300 text-sm underline">
              Download Template
            </button>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }}
              className="text-sm dark:text-gray-300 text-gray-600"
            />
          </div>
          {importFile && (
            <div className="flex gap-3">
              <button onClick={handlePreview} disabled={importUsers.isPending}
                className="dark:bg-gray-700 bg-gray-200 hover:dark:bg-gray-600 hover:bg-gray-300 dark:text-white text-gray-900 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {importUsers.isPending ? 'Processing...' : 'Preview'}
              </button>
              <button onClick={handleImport} disabled={importUsers.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {importUsers.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          )}
          {importUsers.error && (
            <p className="text-red-400 text-sm">{(importUsers.error as Error).message}</p>
          )}
          {importResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="dark:text-green-400 text-green-600 font-medium">
                  {importResult.dryRun ? 'Would import' : 'Imported'}: {importResult.imported}
                </span>
                <span className="dark:text-yellow-400 text-yellow-600 font-medium">
                  Skipped (duplicates): {importResult.skipped}
                </span>
                <span className="dark:text-red-400 text-red-600 font-medium">
                  Errors: {importResult.errors?.length || 0}
                </span>
                <span className="dark:text-gray-400 text-gray-500">
                  Total rows: {importResult.total}
                </span>
                {importResult.dryRun && (
                  <span className="dark:text-blue-400 text-blue-600 font-medium">(Dry run — no changes made)</span>
                )}
              </div>
              {importResult.errors?.length > 0 && (
                <div className="max-h-48 overflow-auto dark:bg-gray-750 bg-gray-50 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="dark:text-gray-400 text-gray-500 text-left">
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Field</th>
                        <th className="px-3 py-2">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
                      {importResult.errors.map((err: any, i: number) => (
                        <tr key={i} className="dark:text-gray-300 text-gray-600">
                          <td className="px-3 py-1.5">{err.row}</td>
                          <td className="px-3 py-1.5">{err.field}</td>
                          <td className="px-3 py-1.5 text-red-400">{err.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <button onClick={() => { setShowImport(false); setImportFile(null); setImportResult(null); }}
            className="dark:text-gray-400 text-gray-500 hover:dark:text-white hover:text-gray-900 text-sm">
            Close
          </button>
        </div>
      )}

      {/* Add User Form */}
      {showAddForm && (
        <form onSubmit={handleCreate} className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-4 space-y-3">
          <h3 className="text-lg font-semibold dark:text-white text-gray-900">New User</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 text-gray-500 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 text-gray-500 mb-1">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="john@school.edu"
              />
            </div>
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 text-gray-500 mb-1">Role *</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 text-gray-500 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone || ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 text-gray-500 mb-1">Password * (min 8 chars)</label>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Min 8 characters"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setForm({ ...EMPTY_FORM }); }}
              className="px-4 py-2 text-sm dark:text-gray-400 text-gray-500 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createUser.isPending}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createUser.isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      {/* Reset Password Modal */}
      {resetPwId && (
        <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-4 space-y-3">
          <h3 className="text-lg font-semibold dark:text-white text-gray-900">Reset Password</h3>
          <p className="text-sm dark:text-gray-400 text-gray-500">
            for {users?.find((u) => u.id === resetPwId)?.name}
          </p>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            minLength={8}
            className="w-full sm:w-80 px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleResetPassword}
              disabled={newPassword.length < 8 || resetPassword.isPending}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {resetPassword.isPending ? 'Resetting...' : 'Reset Password'}
            </button>
            <button
              onClick={() => { setResetPwId(null); setNewPassword(''); }}
              className="px-4 py-2 text-sm dark:text-gray-400 text-gray-500 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="dark:bg-gray-700/50 bg-gray-50 text-left text-sm dark:text-gray-400 text-gray-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Sites</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                  Loading users...
                </td>
              </tr>
            )}
            {users && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
            {users?.map((user) => {
              const isEditing = editingId === user.id;
              return (
                <tr key={user.id} className={`dark:hover:bg-gray-700/30 hover:bg-gray-50 transition-colors ${!user.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-2 py-1 text-sm rounded dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 border dark:border-gray-600 border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="font-medium dark:text-white text-gray-900">{user.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {isEditing ? (
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="w-full px-2 py-1 text-sm rounded dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 border dark:border-gray-600 border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="dark:text-gray-300 text-gray-700">{user.email}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                        className="px-2 py-1 text-sm rounded dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 border dark:border-gray-600 border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || ROLE_COLORS.PARENT}`}>
                        {user.role.replace(/_/g, ' ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm dark:text-gray-400 text-gray-500">
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        className="w-full px-2 py-1 text-sm rounded dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 border dark:border-gray-600 border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      user.phone || '\u2014'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm dark:text-gray-400 text-gray-500">
                    {user.sites.length > 0
                      ? user.sites.map((s) => s.name).join(', ')
                      : '\u2014'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.isActive
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            onClick={handleUpdate}
                            disabled={updateUser.isPending}
                            className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 text-xs dark:text-gray-400 text-gray-500 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(user)}
                            className="px-2 py-1 text-xs font-medium dark:text-blue-400 text-blue-600 dark:hover:text-blue-300 hover:text-blue-700 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setResetPwId(user.id); setNewPassword(''); setMessage(null); }}
                            className="px-2 py-1 text-xs font-medium dark:text-yellow-400 text-yellow-600 dark:hover:text-yellow-300 hover:text-yellow-700 transition-colors"
                          >
                            Reset PW
                          </button>
                          {user.isActive ? (
                            <button
                              onClick={() => handleDeactivate(user)}
                              className="px-2 py-1 text-xs font-medium dark:text-red-400 text-red-600 dark:hover:text-red-300 hover:text-red-700 transition-colors"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReactivate(user)}
                              className="px-2 py-1 text-xs font-medium dark:text-green-400 text-green-600 dark:hover:text-green-300 hover:text-green-700 transition-colors"
                            >
                              Reactivate
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

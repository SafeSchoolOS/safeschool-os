import { useState } from 'react';
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useResetPassword,
  useDeactivateUser,
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

export function UsersPage() {
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPassword = useResetPassword();
  const deactivateUser = useDeactivateUser();

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<CreateUserPayload>({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; email: string; role: string; phone: string }>({ name: '', email: '', role: '', phone: '' });
  const [resetPwId, setResetPwId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
        <button
          onClick={() => { setShowAddForm(!showAddForm); setMessage(null); }}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showAddForm ? 'Cancel' : 'Add User'}
        </button>
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
                      user.phone || '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm dark:text-gray-400 text-gray-500">
                    {user.sites.length > 0
                      ? user.sites.map((s) => s.name).join(', ')
                      : '—'}
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

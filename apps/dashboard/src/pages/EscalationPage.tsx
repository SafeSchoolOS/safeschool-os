import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../api/client';

interface EscalationRule {
  id: string;
  siteId: string;
  name: string;
  alertLevel: string;
  delayMinutes: number;
  action: string;
  targetRoles: string[];
  targetLevel: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RuleFormData {
  name: string;
  alertLevel: string;
  delayMinutes: number;
  action: string;
  targetRoles: string[];
  targetLevel: string;
  isActive: boolean;
}

const ALERT_LEVELS = ['MEDICAL', 'LOCKDOWN', 'ACTIVE_THREAT', 'FIRE', 'WEATHER', 'CUSTOM'];
const ACTIONS = ['NOTIFY_ROLES', 'AUTO_LOCKDOWN', 'AUTO_DISPATCH', 'ESCALATE_LEVEL'];
const ROLES = ['SITE_ADMIN', 'OPERATOR', 'FIRST_RESPONDER', 'TEACHER'];

const ACTION_LABELS: Record<string, string> = {
  NOTIFY_ROLES: 'Notify Roles',
  AUTO_LOCKDOWN: 'Auto Lockdown',
  AUTO_DISPATCH: 'Auto Dispatch',
  ESCALATE_LEVEL: 'Escalate Level',
};

const LEVEL_COLORS: Record<string, string> = {
  MEDICAL: 'bg-blue-600',
  LOCKDOWN: 'bg-orange-600',
  ACTIVE_THREAT: 'bg-red-600',
  FIRE: 'bg-red-500',
  WEATHER: 'bg-yellow-600',
  CUSTOM: 'bg-gray-600',
};

const EMPTY_FORM: RuleFormData = {
  name: '',
  alertLevel: 'LOCKDOWN',
  delayMinutes: 5,
  action: 'NOTIFY_ROLES',
  targetRoles: [],
  targetLevel: '',
  isActive: true,
};

export function EscalationPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const siteId = user?.siteIds[0];

  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<EscalationRule | null>(null);
  const [form, setForm] = useState<RuleFormData>({ ...EMPTY_FORM });

  const { data: rules = [], isLoading } = useQuery<EscalationRule[]>({
    queryKey: ['escalation-rules', siteId],
    queryFn: () => apiClient.get(`/api/v1/escalation/rules/${siteId}`),
    enabled: !!siteId,
  });

  const createMutation = useMutation({
    mutationFn: (data: RuleFormData) => apiClient.post(`/api/v1/escalation/rules/${siteId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-rules'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RuleFormData> }) =>
      apiClient.put(`/api/v1/escalation/rules/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-rules'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/escalation/rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-rules'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.put(`/api/v1/escalation/rules/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-rules'] });
    },
  });

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditingRule(null);
    setShowForm(false);
  }

  function startEdit(rule: EscalationRule) {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      alertLevel: rule.alertLevel,
      delayMinutes: rule.delayMinutes,
      action: rule.action,
      targetRoles: rule.targetRoles,
      targetLevel: rule.targetLevel || '',
      isActive: rule.isActive,
    });
    setShowForm(true);
  }

  function handleSubmit() {
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function toggleRole(role: string) {
    setForm((prev) => ({
      ...prev,
      targetRoles: prev.targetRoles.includes(role)
        ? prev.targetRoles.filter((r) => r !== role)
        : [...prev.targetRoles, role],
    }));
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const canSubmit = form.name && form.alertLevel && form.delayMinutes >= 0 && form.action && !isSubmitting;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-400">
            Configure automatic actions when alerts are not acknowledged within a time threshold.
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setShowForm(true);
            }
          }}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Rule'}
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-gray-800 rounded-lg p-5 mb-6">
          <h3 className="font-semibold mb-4">{editingRule ? 'Edit Rule' : 'New Escalation Rule'}</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Name */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rule Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Notify admins after 5 min"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              />
            </div>

            {/* Alert Level */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Alert Level</label>
              <select
                value={form.alertLevel}
                onChange={(e) => setForm({ ...form, alertLevel: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              >
                {ALERT_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>

            {/* Delay Minutes */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Delay (minutes)</label>
              <input
                type="number"
                min={0}
                value={form.delayMinutes}
                onChange={(e) => setForm({ ...form, delayMinutes: parseInt(e.target.value) || 0 })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              />
            </div>

            {/* Action */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Action</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              >
                {ACTIONS.map((action) => (
                  <option key={action} value={action}>{ACTION_LABELS[action]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Roles (shown for NOTIFY_ROLES action) */}
          {form.action === 'NOTIFY_ROLES' && (
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-2">Target Roles</label>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      form.targetRoles.includes(role)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Target Level (shown for ESCALATE_LEVEL action) */}
          {form.action === 'ESCALATE_LEVEL' && (
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">Escalate To Level</label>
              <select
                value={form.targetLevel}
                onChange={(e) => setForm({ ...form, targetLevel: e.target.value })}
                className="w-full max-w-xs bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              >
                <option value="">Select level...</option>
                {ALERT_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
          )}

          {/* Active Toggle */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm">Active</span>
            </label>
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
            </button>
            <button
              onClick={resetForm}
              className="bg-gray-600 hover:bg-gray-700 px-4 py-1.5 rounded text-sm transition-colors"
            >
              Cancel
            </button>
          </div>

          {(createMutation.isError || updateMutation.isError) && (
            <div className="mt-3 text-sm text-red-400">
              {(createMutation.error || updateMutation.error)?.message || 'Failed to save rule'}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Rules Table */}
      {!isLoading && rules.length > 0 && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left">
                <th className="px-4 py-3 text-gray-400 font-medium">Name</th>
                <th className="px-4 py-3 text-gray-400 font-medium">Alert Level</th>
                <th className="px-4 py-3 text-gray-400 font-medium">Delay</th>
                <th className="px-4 py-3 text-gray-400 font-medium">Action</th>
                <th className="px-4 py-3 text-gray-400 font-medium">Active</th>
                <th className="px-4 py-3 text-gray-400 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{rule.name}</div>
                    {rule.action === 'NOTIFY_ROLES' && rule.targetRoles.length > 0 && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Roles: {rule.targetRoles.join(', ')}
                      </div>
                    )}
                    {rule.action === 'ESCALATE_LEVEL' && rule.targetLevel && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Escalate to: {rule.targetLevel}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`${LEVEL_COLORS[rule.alertLevel] || 'bg-gray-600'} px-2 py-0.5 rounded text-xs font-bold`}>
                      {rule.alertLevel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {rule.delayMinutes} min
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {ACTION_LABELS[rule.action] || rule.action}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        rule.isActive ? 'bg-blue-600' : 'bg-gray-600'
                      }`}
                      title={rule.isActive ? 'Disable rule' : 'Enable rule'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          rule.isActive ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => startEdit(rule)}
                        className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete rule "${rule.name}"?`)) {
                            deleteMutation.mutate(rule.id);
                          }
                        }}
                        className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && rules.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p>No escalation rules configured.</p>
          <p className="text-sm mt-1">Create rules to automate responses when alerts go unacknowledged.</p>
        </div>
      )}
    </div>
  );
}

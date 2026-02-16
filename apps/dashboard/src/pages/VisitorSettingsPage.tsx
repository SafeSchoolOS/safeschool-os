import { useState, useEffect } from 'react';
import {
  useVisitorSettings,
  useUpdateVisitorSettings,
  useVisitorPolicies,
  useCreateVisitorPolicy,
  useUpdateVisitorPolicy,
  useDeleteVisitorPolicy,
} from '../api/visitors';

interface VisitorSettingsData {
  hostNotificationEnabled: boolean;
  autoCheckoutEnabled: boolean;
  autoCheckoutTime: string;
  requireSignature: boolean;
  requirePhoto: boolean;
  requirePolicyAck: boolean;
  publicPreRegEnabled: boolean;
}

interface Policy {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
}

const DEFAULT_SETTINGS: VisitorSettingsData = {
  hostNotificationEnabled: true,
  autoCheckoutEnabled: false,
  autoCheckoutTime: '17:00',
  requireSignature: false,
  requirePhoto: false,
  requirePolicyAck: false,
  publicPreRegEnabled: false,
};

function Toggle({
  enabled,
  onChange,
  label,
  description,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-white dark:text-white">{label}</p>
        {description && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 dark:focus:ring-offset-gray-900 ${
          enabled ? 'bg-blue-600' : 'bg-gray-600'
        }`}
        role="switch"
        aria-checked={enabled}
        aria-label={label}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function VisitorSettingsPage() {
  const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useVisitorSettings();
  const updateSettings = useUpdateVisitorSettings();
  const { data: policiesData, isLoading: policiesLoading, error: policiesError } = useVisitorPolicies();
  const createPolicy = useCreateVisitorPolicy();
  const updatePolicy = useUpdateVisitorPolicy();
  const deletePolicy = useDeleteVisitorPolicy();

  const [settings, setSettings] = useState<VisitorSettingsData>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  const [newPolicyTitle, setNewPolicyTitle] = useState('');
  const [newPolicyBody, setNewPolicyBody] = useState('');
  const [showNewPolicyForm, setShowNewPolicyForm] = useState(false);

  useEffect(() => {
    if (settingsData) {
      setSettings({
        hostNotificationEnabled: settingsData.hostNotificationEnabled ?? DEFAULT_SETTINGS.hostNotificationEnabled,
        autoCheckoutEnabled: settingsData.autoCheckoutEnabled ?? DEFAULT_SETTINGS.autoCheckoutEnabled,
        autoCheckoutTime: settingsData.autoCheckoutTime ?? DEFAULT_SETTINGS.autoCheckoutTime,
        requireSignature: settingsData.requireSignature ?? DEFAULT_SETTINGS.requireSignature,
        requirePhoto: settingsData.requirePhoto ?? DEFAULT_SETTINGS.requirePhoto,
        requirePolicyAck: settingsData.requirePolicyAck ?? DEFAULT_SETTINGS.requirePolicyAck,
        publicPreRegEnabled: settingsData.publicPreRegEnabled ?? DEFAULT_SETTINGS.publicPreRegEnabled,
      });
      setHasChanges(false);
    }
  }, [settingsData]);

  const updateField = <K extends keyof VisitorSettingsData>(key: K, value: VisitorSettingsData[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings.mutate(settings);
    setHasChanges(false);
  };

  const handleCreatePolicy = () => {
    if (!newPolicyTitle.trim() || !newPolicyBody.trim()) return;
    createPolicy.mutate(
      { title: newPolicyTitle.trim(), body: newPolicyBody.trim() },
      {
        onSuccess: () => {
          setNewPolicyTitle('');
          setNewPolicyBody('');
          setShowNewPolicyForm(false);
        },
      },
    );
  };

  const handleTogglePolicy = (policy: Policy) => {
    updatePolicy.mutate({ id: policy.id, isActive: !policy.isActive });
  };

  const handleDeletePolicy = (id: string) => {
    if (!confirm('Are you sure you want to delete this policy?')) return;
    deletePolicy.mutate(id);
  };

  const policies: Policy[] = policiesData?.policies || policiesData || [];

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6 sm:space-y-8">
      {/* Visitor Settings Section */}
      <section className="bg-gray-800 dark:bg-gray-900 rounded-xl border border-gray-700 dark:border-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Visitor Settings</h2>
            <p className="text-sm text-gray-400 mt-1">
              Configure check-in requirements and visitor experience options.
            </p>
          </div>
        </div>

        {settingsLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-gray-400 text-sm">Loading settings...</span>
          </div>
        )}

        {settingsError && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-sm text-red-400">
            Failed to load visitor settings. Please try again.
          </div>
        )}

        {!settingsLoading && !settingsError && (
          <>
            <div className="divide-y divide-gray-700 dark:divide-gray-800">
              <Toggle
                enabled={settings.hostNotificationEnabled}
                onChange={(v) => updateField('hostNotificationEnabled', v)}
                label="Host Notifications"
                description="Notify the host when their visitor checks in"
              />
              <Toggle
                enabled={settings.autoCheckoutEnabled}
                onChange={(v) => updateField('autoCheckoutEnabled', v)}
                label="Auto Checkout"
                description="Automatically check out visitors at the specified time"
              />
              {settings.autoCheckoutEnabled && (
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-white">Auto Checkout Time</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Time to automatically check out remaining visitors
                    </p>
                  </div>
                  <input
                    type="time"
                    value={settings.autoCheckoutTime}
                    onChange={(e) => updateField('autoCheckoutTime', e.target.value)}
                    className="px-3 py-1.5 bg-gray-900 dark:bg-gray-950 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              <Toggle
                enabled={settings.requireSignature}
                onChange={(v) => updateField('requireSignature', v)}
                label="Require Signature"
                description="Visitors must provide a digital signature during check-in"
              />
              <Toggle
                enabled={settings.requirePhoto}
                onChange={(v) => updateField('requirePhoto', v)}
                label="Require Photo"
                description="Capture a photo of the visitor during check-in"
              />
              <Toggle
                enabled={settings.requirePolicyAck}
                onChange={(v) => updateField('requirePolicyAck', v)}
                label="Require Policy Acknowledgment"
                description="Visitors must acknowledge site policies before check-in"
              />
              <Toggle
                enabled={settings.publicPreRegEnabled}
                onChange={(v) => updateField('publicPreRegEnabled', v)}
                label="Public Pre-Registration"
                description="Allow visitors to pre-register via a public link"
              />
            </div>

            <div className="flex items-center justify-end mt-6 pt-4 border-t border-gray-700">
              <div className="flex items-center gap-3">
                {updateSettings.isError && (
                  <span className="text-sm text-red-400">Failed to save. Try again.</span>
                )}
                {updateSettings.isSuccess && !hasChanges && (
                  <span className="text-sm text-green-400">Saved successfully</span>
                )}
                <button
                  onClick={handleSave}
                  disabled={!hasChanges || updateSettings.isPending}
                  className={`px-6 py-2 text-sm font-medium rounded-lg transition-colors ${
                    hasChanges && !updateSettings.isPending
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Policy Management Section */}
      <section className="bg-gray-800 dark:bg-gray-900 rounded-xl border border-gray-700 dark:border-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Visitor Policies</h2>
            <p className="text-sm text-gray-400 mt-1">
              Manage policies that visitors must acknowledge during check-in.
            </p>
          </div>
          <button
            onClick={() => setShowNewPolicyForm(!showNewPolicyForm)}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {showNewPolicyForm ? 'Cancel' : 'Add Policy'}
          </button>
        </div>

        {/* New Policy Form */}
        {showNewPolicyForm && (
          <div className="mb-6 p-4 bg-gray-900 dark:bg-gray-950 rounded-lg border border-gray-700">
            <h3 className="text-sm font-medium text-white mb-3">New Policy</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Title</label>
                <input
                  type="text"
                  value={newPolicyTitle}
                  onChange={(e) => setNewPolicyTitle(e.target.value)}
                  placeholder="e.g., Visitor Code of Conduct"
                  className="w-full px-3 py-2 bg-gray-800 dark:bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Body</label>
                <textarea
                  value={newPolicyBody}
                  onChange={(e) => setNewPolicyBody(e.target.value)}
                  placeholder="Enter the full policy text..."
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-800 dark:bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleCreatePolicy}
                  disabled={!newPolicyTitle.trim() || !newPolicyBody.trim() || createPolicy.isPending}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    newPolicyTitle.trim() && newPolicyBody.trim() && !createPolicy.isPending
                      ? 'bg-green-600 hover:bg-green-500 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {createPolicy.isPending ? 'Creating...' : 'Create Policy'}
                </button>
              </div>
            </div>
          </div>
        )}

        {policiesLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-gray-400 text-sm">Loading policies...</span>
          </div>
        )}

        {policiesError && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-sm text-red-400">
            Failed to load policies. Please try again.
          </div>
        )}

        {!policiesLoading && !policiesError && (
          <>
            {Array.isArray(policies) && policies.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                No policies configured. Click "Add Policy" to create one.
              </div>
            )}

            <div className="space-y-3">
              {Array.isArray(policies) &&
                policies.map((policy: Policy) => (
                  <div
                    key={policy.id}
                    className="p-4 bg-gray-900 dark:bg-gray-950 rounded-lg border border-gray-700 dark:border-gray-800"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-white truncate">{policy.title}</h3>
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                              policy.isActive
                                ? 'bg-green-600/20 text-green-400'
                                : 'bg-gray-600/20 text-gray-400'
                            }`}
                          >
                            {policy.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{policy.body}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleTogglePolicy(policy)}
                          disabled={updatePolicy.isPending}
                          className="px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
                        >
                          {policy.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => handleDeletePolicy(policy.id)}
                          disabled={deletePolicy.isPending}
                          className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-700/50 hover:border-red-600 rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

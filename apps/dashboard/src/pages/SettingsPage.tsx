import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../api/client';

const CHANNELS = ['SMS', 'EMAIL', 'PUSH'] as const;
const ALERT_LEVELS = ['MEDICAL', 'LOCKDOWN', 'ACTIVE_THREAT', 'FIRE', 'WEATHER', 'ALL_CLEAR'] as const;

type Channel = (typeof CHANNELS)[number];
type AlertLevel = (typeof ALERT_LEVELS)[number];

interface Preference {
  channel: Channel;
  alertLevel: AlertLevel;
  enabled: boolean;
}

const CHANNEL_LABELS: Record<Channel, string> = {
  SMS: 'SMS',
  EMAIL: 'Email',
  PUSH: 'Push',
};

const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
  MEDICAL: 'Medical',
  LOCKDOWN: 'Lockdown',
  ACTIVE_THREAT: 'Active Threat',
  FIRE: 'Fire',
  WEATHER: 'Weather',
  ALL_CLEAR: 'All Clear',
};

const ALERT_LEVEL_COLORS: Record<AlertLevel, string> = {
  MEDICAL: 'text-blue-400',
  LOCKDOWN: 'text-yellow-400',
  ACTIVE_THREAT: 'text-red-400',
  FIRE: 'text-orange-400',
  WEATHER: 'text-cyan-400',
  ALL_CLEAR: 'text-green-400',
};

function buildDefaultPrefs(): Record<string, boolean> {
  const prefs: Record<string, boolean> = {};
  for (const level of ALERT_LEVELS) {
    for (const channel of CHANNELS) {
      prefs[`${level}:${channel}`] = true;
    }
  }
  return prefs;
}

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [localPrefs, setLocalPrefs] = useState<Record<string, boolean>>(buildDefaultPrefs);
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiClient.get('/api/v1/notification-preferences'),
  });

  // Sync fetched prefs into local state
  useEffect(() => {
    if (!data?.preferences) return;
    const map: Record<string, boolean> = {};
    for (const pref of data.preferences) {
      map[`${pref.alertLevel}:${pref.channel}`] = pref.enabled;
    }
    // Fill in any missing combos with defaults (enabled)
    for (const level of ALERT_LEVELS) {
      for (const channel of CHANNELS) {
        const key = `${level}:${channel}`;
        if (!(key in map)) {
          map[key] = true;
        }
      }
    }
    setLocalPrefs(map);
    setHasChanges(false);
  }, [data]);

  const togglePref = useCallback((level: AlertLevel, channel: Channel) => {
    setLocalPrefs((prev) => {
      const key = `${level}:${channel}`;
      return { ...prev, [key]: !prev[key] };
    });
    setHasChanges(true);
  }, []);

  const resetToDefaults = useCallback(() => {
    setLocalPrefs(buildDefaultPrefs());
    setHasChanges(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (prefs: Preference[]) => {
      return apiClient.put('/api/v1/notification-preferences', { preferences: prefs });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      setHasChanges(false);
    },
  });

  const handleSave = () => {
    const preferences: Preference[] = [];
    for (const level of ALERT_LEVELS) {
      for (const channel of CHANNELS) {
        const key = `${level}:${channel}`;
        preferences.push({
          channel,
          alertLevel: level,
          enabled: localPrefs[key] ?? true,
        });
      }
    }
    saveMutation.mutate(preferences);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* User Profile Section */}
      <section className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">User Profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <div className="px-3 py-2 bg-gray-900 rounded-lg border border-gray-700 text-white text-sm">
              {user?.name || '--'}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <div className="px-3 py-2 bg-gray-900 rounded-lg border border-gray-700 text-white text-sm">
              {user?.email || '--'}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Role</label>
            <div className="px-3 py-2 bg-gray-900 rounded-lg border border-gray-700 text-white text-sm">
              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-blue-600/20 text-blue-400">
                {user?.role || '--'}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">User ID</label>
            <div className="px-3 py-2 bg-gray-900 rounded-lg border border-gray-700 text-gray-500 text-sm font-mono truncate">
              {user?.id || '--'}
            </div>
          </div>
        </div>
      </section>

      {/* Notification Preferences Section */}
      <section className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Notification Preferences</h2>
            <p className="text-sm text-gray-400 mt-1">
              Choose which alert types you want to receive on each channel.
            </p>
          </div>
          {data?.isDefault && (
            <span className="text-xs px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded">
              Using defaults
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-gray-400 text-sm">Loading preferences...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-sm text-red-400">
            Failed to load notification preferences. Please try again.
          </div>
        )}

        {!isLoading && !error && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="py-3 px-4 text-left text-sm font-medium text-gray-400">
                      Alert Level
                    </th>
                    {CHANNELS.map((channel) => (
                      <th
                        key={channel}
                        className="py-3 px-4 text-center text-sm font-medium text-gray-400"
                      >
                        {CHANNEL_LABELS[channel]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALERT_LEVELS.map((level) => (
                    <tr
                      key={level}
                      className="border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className={`text-sm font-medium ${ALERT_LEVEL_COLORS[level]}`}>
                          {ALERT_LEVEL_LABELS[level]}
                        </span>
                      </td>
                      {CHANNELS.map((channel) => {
                        const key = `${level}:${channel}`;
                        const enabled = localPrefs[key] ?? true;
                        return (
                          <td key={channel} className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => togglePref(level, channel)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
                                enabled ? 'bg-blue-600' : 'bg-gray-600'
                              }`}
                              role="switch"
                              aria-checked={enabled}
                              aria-label={`${ALERT_LEVEL_LABELS[level]} via ${CHANNEL_LABELS[channel]}`}
                            >
                              <span
                                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                                  enabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-700">
              <button
                onClick={resetToDefaults}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
              >
                Reset to Defaults
              </button>
              <div className="flex items-center gap-3">
                {saveMutation.isError && (
                  <span className="text-sm text-red-400">Failed to save. Try again.</span>
                )}
                {saveMutation.isSuccess && !hasChanges && (
                  <span className="text-sm text-green-400">Saved successfully</span>
                )}
                <button
                  onClick={handleSave}
                  disabled={!hasChanges || saveMutation.isPending}
                  className={`px-6 py-2 text-sm font-medium rounded-lg transition-colors ${
                    hasChanges && !saveMutation.isPending
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

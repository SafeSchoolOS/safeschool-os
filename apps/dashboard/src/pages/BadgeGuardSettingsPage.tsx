import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';

interface BadgeGuardConfig {
  configured: boolean;
  id?: string;
  apiUrl?: string;
  apiKeyMasked?: string;
  enabled?: boolean;
  deviceId?: string;
  pushInterval?: number;
  lastPushAt?: string;
  lastAlertAt?: string;
  alertCount?: number;
}

export function BadgeGuardSettingsPage() {
  const queryClient = useQueryClient();
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [pushInterval, setPushInterval] = useState(300);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; version?: string } | null>(null);

  const { data: config, isLoading } = useQuery<BadgeGuardConfig>({
    queryKey: ['badgeguard', 'config'],
    queryFn: () => apiClient.get('/api/v1/badgeguard/config'),
  });

  // Sync form state from fetched config
  useEffect(() => {
    if (config?.configured) {
      setApiUrl(config.apiUrl || '');
      setEnabled(config.enabled ?? true);
      setPushInterval(config.pushInterval || 300);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: (body: any) => apiClient.put('/api/v1/badgeguard/config', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['badgeguard'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/badgeguard/test', {}),
    onSuccess: (data: any) => setTestResult(data),
    onError: (err: any) => setTestResult({ ok: false, message: err.message }),
  });

  const pushMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/badgeguard/push', {}),
  });

  const handleSave = () => {
    const body: any = { enabled, pushInterval };
    if (apiUrl) body.apiUrl = apiUrl;
    if (apiKey) body.apiKey = apiKey;
    saveMutation.mutate(body);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/access-analytics"
          className="p-1.5 dark:hover:bg-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h2 className="text-xl font-semibold">BadgeGuard Settings</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500">
            Configure your BadgeGuard access control analytics integration
          </p>
        </div>
      </div>

      {/* Connection Config */}
      <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-6 space-y-4">
        <h3 className="font-semibold">Connection</h3>

        <div>
          <label className="block text-sm font-medium mb-1">API URL</label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://badgeguard-production.up.railway.app"
            className="w-full dark:bg-gray-700 bg-gray-100 rounded-lg px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            API Key {config?.configured && <span className="dark:text-gray-500 text-gray-400">(masked: {config.apiKeyMasked})</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.configured ? 'Leave blank to keep existing key' : 'Enter your BadgeGuard API key'}
            className="w-full dark:bg-gray-700 bg-gray-100 rounded-lg px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="px-4 py-2 text-sm dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {testMutation.isPending ? 'Testing...' : 'Test Connection'}
          </button>
          {testResult && (
            <span className={`text-sm ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.ok
                ? `Connected${testResult.version ? ` (v${testResult.version})` : ''}`
                : `Failed: ${testResult.message}`}
            </span>
          )}
        </div>
      </div>

      {/* Integration Settings */}
      <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-6 space-y-4">
        <h3 className="font-semibold">Settings</h3>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Enabled</div>
            <div className="text-xs dark:text-gray-400 text-gray-500">
              Send access control events to BadgeGuard for analysis
            </div>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              enabled ? 'bg-blue-600' : 'dark:bg-gray-600 bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                enabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Push Interval (seconds)</label>
          <select
            value={pushInterval}
            onChange={(e) => setPushInterval(Number(e.target.value))}
            className="dark:bg-gray-700 bg-gray-100 rounded-lg px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value={60}>Every 1 minute</option>
            <option value={300}>Every 5 minutes</option>
            <option value={600}>Every 10 minutes</option>
            <option value={900}>Every 15 minutes</option>
            <option value={1800}>Every 30 minutes</option>
          </select>
          <p className="text-xs dark:text-gray-500 text-gray-400 mt-1">
            How often door events are batched and sent to BadgeGuard
          </p>
        </div>
      </div>

      {/* Status */}
      {config?.configured && (
        <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-6 space-y-3">
          <h3 className="font-semibold">Status</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="dark:text-gray-400 text-gray-500">Device ID:</span>
              <span className="ml-2 font-mono text-xs">{config.deviceId || 'Not registered'}</span>
            </div>
            <div>
              <span className="dark:text-gray-400 text-gray-500">Last Push:</span>
              <span className="ml-2">
                {config.lastPushAt ? new Date(config.lastPushAt).toLocaleString() : 'Never'}
              </span>
            </div>
            <div>
              <span className="dark:text-gray-400 text-gray-500">Last Alert:</span>
              <span className="ml-2">
                {config.lastAlertAt ? new Date(config.lastAlertAt).toLocaleString() : 'None'}
              </span>
            </div>
            <div>
              <span className="dark:text-gray-400 text-gray-500">Alert Count:</span>
              <span className="ml-2">{config.alertCount ?? 0}</span>
            </div>
          </div>

          <button
            onClick={() => pushMutation.mutate()}
            disabled={pushMutation.isPending}
            className="mt-2 px-4 py-2 text-sm dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {pushMutation.isPending ? 'Pushing...' : 'Manual Push Now'}
          </button>
          {pushMutation.isSuccess && (
            <span className="ml-3 text-sm text-green-400">
              Pushed {(pushMutation.data as any)?.pushed ?? 0} events
            </span>
          )}
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end gap-3">
        <Link
          to="/access-analytics"
          className="px-4 py-2 text-sm dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 rounded-lg transition-colors"
        >
          Cancel
        </Link>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
      {saveMutation.isSuccess && (
        <div className="text-sm text-green-400 text-right">Settings saved successfully</div>
      )}
      {saveMutation.isError && (
        <div className="text-sm text-red-400 text-right">
          Error: {(saveMutation.error as any)?.message || 'Failed to save'}
        </div>
      )}
    </div>
  );
}

export default BadgeGuardSettingsPage;

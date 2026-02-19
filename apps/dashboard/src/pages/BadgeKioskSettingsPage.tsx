import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';

interface BKConfig {
  configured: boolean;
  id?: string;
  apiUrl?: string;
  apiKeyMasked?: string;
  enabled?: boolean;
  autoSync?: boolean;
  autoPrint?: boolean;
  defaultTemplate?: string;
  defaultPrinter?: string;
  features?: Record<string, boolean>;
  lastSyncAt?: string;
}

interface BKTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

interface BKPrinter {
  id: string;
  name: string;
  status: string;
  location?: string;
}

interface TestResult {
  ok: boolean;
  features?: Record<string, boolean>;
  error?: string;
}

export function BadgeKioskSettingsPage() {
  const queryClient = useQueryClient();

  // Form state
  const [apiUrl, setApiUrl] = useState('https://backend-production-345e.up.railway.app');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [autoPrint, setAutoPrint] = useState(false);
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [defaultPrinter, setDefaultPrinter] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Fetch current config
  const { data: config, isLoading } = useQuery<BKConfig>({
    queryKey: ['badgekiosk-config'],
    queryFn: () => apiClient.get('/api/v1/badgekiosk/config'),
  });

  // Fetch templates (only when configured)
  const { data: templates } = useQuery<BKTemplate[]>({
    queryKey: ['badgekiosk-templates'],
    queryFn: () => apiClient.get('/api/v1/badgekiosk/templates'),
    enabled: !!config?.configured,
  });

  // Fetch printers (only when configured)
  const { data: printers } = useQuery<BKPrinter[]>({
    queryKey: ['badgekiosk-printers'],
    queryFn: () => apiClient.get('/api/v1/badgekiosk/printers'),
    enabled: !!config?.configured,
  });

  // Sync form state from fetched config
  useEffect(() => {
    if (!config?.configured) return;
    if (config.apiUrl) setApiUrl(config.apiUrl);
    setEnabled(config.enabled ?? true);
    setAutoSync(config.autoSync ?? true);
    setAutoPrint(config.autoPrint ?? false);
    setDefaultTemplate(config.defaultTemplate || '');
    setDefaultPrinter(config.defaultPrinter || '');
  }, [config]);

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: (data: any) => apiClient.put('/api/v1/badgekiosk/config', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['badgekiosk-config'] });
      setApiKey(''); // Clear API key field after save
    },
  });

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/badgekiosk/test', {}),
    onSuccess: (result: TestResult) => {
      setTestResult(result);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['badgekiosk-config'] });
        queryClient.invalidateQueries({ queryKey: ['badgekiosk-templates'] });
        queryClient.invalidateQueries({ queryKey: ['badgekiosk-printers'] });
      }
    },
  });

  const handleSave = () => {
    const data: any = { apiUrl, enabled, autoSync, autoPrint };
    if (apiKey) data.apiKey = apiKey;
    if (defaultTemplate) data.defaultTemplate = defaultTemplate;
    if (defaultPrinter) data.defaultPrinter = defaultPrinter;
    saveMutation.mutate(data);
  };

  const features = config?.features || {};

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold dark:text-white text-gray-900">BadgeKiosk Integration</h1>
        <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
          Connect to BadgeKiosk for visitor badge printing and guard console features.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* API Configuration */}
          <section className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-6">
            <h2 className="text-lg font-semibold dark:text-white text-gray-900 mb-4">API Configuration</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">API URL</label>
                <input
                  type="url"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="w-full px-3 py-2 dark:bg-gray-900 bg-gray-50 rounded-lg dark:border-gray-700 border-gray-200 border dark:text-white text-gray-900 text-sm"
                  placeholder="https://backend-production-345e.up.railway.app"
                />
              </div>

              <div>
                <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">
                  API Key {config?.configured && <span className="text-xs dark:text-gray-600 text-gray-400">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 dark:bg-gray-900 bg-gray-50 rounded-lg dark:border-gray-700 border-gray-200 border dark:text-white text-gray-900 text-sm"
                  placeholder={config?.apiKeyMasked || 'Enter your BadgeKiosk API key'}
                />
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="rounded dark:bg-gray-700 bg-gray-200 border-0"
                  />
                  <span className="text-sm dark:text-gray-300 text-gray-700">Enabled</span>
                </label>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || (!apiKey && !config?.configured)}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
                </button>

                {config?.configured && (
                  <button
                    onClick={() => testMutation.mutate()}
                    disabled={testMutation.isPending}
                    className="px-4 py-2 text-sm font-medium dark:bg-gray-700 bg-gray-100 dark:hover:bg-gray-600 hover:bg-gray-200 dark:text-gray-300 text-gray-700 rounded-lg transition-colors"
                  >
                    {testMutation.isPending ? 'Testing...' : 'Test Connection'}
                  </button>
                )}

                {saveMutation.isSuccess && (
                  <span className="text-sm text-green-400">Saved</span>
                )}
                {saveMutation.isError && (
                  <span className="text-sm text-red-400">Failed to save</span>
                )}
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${
                  testResult.ok
                    ? 'bg-green-900/20 border border-green-700 text-green-400'
                    : 'bg-red-900/20 border border-red-700 text-red-400'
                }`}>
                  {testResult.ok ? 'Connection successful' : `Connection failed: ${testResult.error}`}
                </div>
              )}
            </div>
          </section>

          {/* Print Settings (only if configured) */}
          {config?.configured && (
            <section className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-6">
              <h2 className="text-lg font-semibold dark:text-white text-gray-900 mb-4">Print Settings</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">Default Badge Template</label>
                  <select
                    value={defaultTemplate}
                    onChange={(e) => setDefaultTemplate(e.target.value)}
                    className="w-full px-3 py-2 dark:bg-gray-900 bg-gray-50 rounded-lg dark:border-gray-700 border-gray-200 border dark:text-white text-gray-900 text-sm"
                  >
                    <option value="">Select a template...</option>
                    {(templates || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.isDefault ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">Default Printer</label>
                  <select
                    value={defaultPrinter}
                    onChange={(e) => setDefaultPrinter(e.target.value)}
                    className="w-full px-3 py-2 dark:bg-gray-900 bg-gray-50 rounded-lg dark:border-gray-700 border-gray-200 border dark:text-white text-gray-900 text-sm"
                  >
                    <option value="">Select a printer...</option>
                    {(printers || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.status}){p.location ? ` - ${p.location}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSync}
                      onChange={(e) => setAutoSync(e.target.checked)}
                      className="rounded dark:bg-gray-700 bg-gray-200 border-0"
                    />
                    <span className="text-sm dark:text-gray-300 text-gray-700">
                      Auto-sync visitors to BadgeKiosk on check-in
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoPrint}
                      onChange={(e) => setAutoPrint(e.target.checked)}
                      className="rounded dark:bg-gray-700 bg-gray-200 border-0"
                    />
                    <span className="text-sm dark:text-gray-300 text-gray-700">
                      Auto-print badge on visitor check-in
                    </span>
                  </label>
                </div>

                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Print Settings'}
                </button>
              </div>
            </section>
          )}

          {/* Feature Availability */}
          {config?.configured && (
            <section className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-6">
              <h2 className="text-lg font-semibold dark:text-white text-gray-900 mb-4">Feature Availability</h2>
              <p className="text-sm dark:text-gray-400 text-gray-500 mb-4">
                Features available based on your BadgeKiosk subscription tier.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: 'badgePrinting', label: 'Badge Printing', desc: 'Print visitor badges on thermal printers' },
                  { key: 'guardConsole', label: 'Guard Console', desc: 'QR scan validation and checkpoint management' },
                  { key: 'photoVerification', label: 'Photo Verification', desc: 'Verify visitor identity with photo match' },
                  { key: 'qrValidation', label: 'QR Validation', desc: 'Validate visitor badges via QR scan' },
                  { key: 'visitorPreRegistration', label: 'Visitor Pre-Registration', desc: 'Pre-register visitors in BadgeKiosk' },
                  { key: 'multiSite', label: 'Multi-Site', desc: 'Manage multiple sites from one account' },
                ].map(({ key, label, desc }) => {
                  const isEnabled = !!(features as any)[key];
                  return (
                    <div
                      key={key}
                      className={`p-3 rounded-lg border ${
                        isEnabled
                          ? 'dark:border-green-700 border-green-300 dark:bg-green-900/10 bg-green-50'
                          : 'dark:border-gray-700 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-green-400' : 'dark:bg-gray-600 bg-gray-300'}`} />
                        <span className="text-sm font-medium dark:text-white text-gray-900">{label}</span>
                      </div>
                      <p className="text-xs dark:text-gray-500 text-gray-400 ml-4">{desc}</p>
                    </div>
                  );
                })}
              </div>

              {(features as any).tier && (
                <div className="mt-4 text-sm dark:text-gray-400 text-gray-500">
                  Current tier: <span className="font-medium dark:text-white text-gray-900 capitalize">{(features as any).tier}</span>
                </div>
              )}

              {config.lastSyncAt && (
                <div className="mt-2 text-xs dark:text-gray-600 text-gray-400">
                  Last synced: {new Date(config.lastSyncAt).toLocaleString()}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

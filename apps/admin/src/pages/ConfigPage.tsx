import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, AlertTriangle } from 'lucide-react';
import { adminApi, type ConfigEntry } from '../api/client';

export function ConfigPage() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-config'],
    queryFn: adminApi.getConfig,
  });

  const mutation = useMutation({
    mutationFn: (updates: Record<string, string>) => adminApi.updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config'] });
      setEdits({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading configuration...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-lg p-4">
        <p className="text-red-300">Failed to load configuration: {(error as Error).message}</p>
      </div>
    );
  }

  const config = data?.config || [];
  const hasEdits = Object.keys(edits).length > 0;

  const handleEdit = (key: string, value: string) => {
    const original = config.find((c: ConfigEntry) => c.key === key);
    if (original && original.value === value) {
      const next = { ...edits };
      delete next[key];
      setEdits(next);
    } else {
      setEdits({ ...edits, [key]: value });
    }
  };

  const handleSave = () => {
    if (hasEdits) {
      mutation.mutate(edits);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Configuration</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-green-400 text-sm">Saved! Restart services to apply.</span>}
          <button
            onClick={handleSave}
            disabled={!hasEdits || mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            <Save size={16} />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {mutation.isError && (
        <div className="bg-red-900/30 border border-red-500 rounded-lg p-3 mb-4 text-sm text-red-300">
          Failed to save: {(mutation.error as Error).message}
        </div>
      )}

      <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-yellow-300">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <span>Changes to configuration require a service restart to take effect. Secrets are redacted for security.</span>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left px-4 py-2 w-1/3">Key</th>
              <th className="text-left px-4 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {config.map((entry: ConfigEntry) => (
              <tr key={entry.key} className="border-b border-gray-700/50">
                <td className="px-4 py-2 font-mono text-xs text-gray-300">{entry.key}</td>
                <td className="px-4 py-2">
                  {entry.redacted ? (
                    <span className="text-gray-500 italic">***redacted***</span>
                  ) : (
                    <input
                      type="text"
                      value={edits[entry.key] ?? entry.value}
                      onChange={(e) => handleEdit(entry.key, e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

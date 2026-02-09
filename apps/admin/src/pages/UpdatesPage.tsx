import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, CheckCircle, AlertTriangle } from 'lucide-react';
import { adminApi } from '../api/client';

export function UpdatesPage() {
  const [result, setResult] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: () => adminApi.checkUpdate(),
    onSuccess: (data) => {
      setResult(data.message);
    },
  });

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Updates</h2>

      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-start gap-4">
          <Download size={24} className="text-blue-400 mt-1" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Check for Updates</h3>
            <p className="text-gray-400 text-sm mb-4">
              Pull the latest Docker images and restart services. This will cause a brief interruption
              while containers are recreated.
            </p>

            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
            >
              <Download size={16} />
              {updateMutation.isPending ? 'Updating...' : 'Pull & Restart'}
            </button>
          </div>
        </div>

        {result && (
          <div className="mt-4 bg-green-900/20 border border-green-700 rounded-lg p-3 flex items-start gap-2 text-sm text-green-300">
            <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{result}</span>
          </div>
        )}

        {updateMutation.isError && (
          <div className="mt-4 bg-red-900/20 border border-red-500 rounded-lg p-3 flex items-start gap-2 text-sm text-red-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>Update failed: {(updateMutation.error as Error).message}</span>
          </div>
        )}
      </div>

      <div className="mt-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-2">Manual Update</h3>
        <p className="text-gray-400 text-sm mb-3">
          To manually update, SSH into the edge device and run:
        </p>
        <div className="bg-gray-950 rounded-lg p-3 font-mono text-xs text-gray-300">
          <div>cd /path/to/deploy/edge</div>
          <div>docker compose pull</div>
          <div>docker compose up -d</div>
        </div>
      </div>
    </div>
  );
}

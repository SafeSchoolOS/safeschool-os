import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api/client';
import { ServiceRow } from '../components/ServiceRow';

export function ServicesPage() {
  const queryClient = useQueryClient();
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [selectedLogService, setSelectedLogService] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-services'],
    queryFn: adminApi.getServices,
    refetchInterval: 10000,
  });

  const { data: logsData } = useQuery({
    queryKey: ['admin-logs', selectedLogService],
    queryFn: () => adminApi.getLogs(selectedLogService!),
    enabled: !!selectedLogService,
    refetchInterval: 5000,
  });

  const restartMutation = useMutation({
    mutationFn: (name: string) => adminApi.restartService(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-services'] });
      setRestartingService(null);
    },
    onError: () => {
      setRestartingService(null);
    },
  });

  const handleRestart = (name: string) => {
    setRestartingService(name);
    restartMutation.mutate(name);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading services...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-lg p-4">
        <p className="text-red-300">Failed to load services: {(error as Error).message}</p>
      </div>
    );
  }

  const services = data?.services || [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Services</h2>

      <div className="space-y-3 mb-8">
        {services.map((svc) => (
          <div key={svc.name} onClick={() => setSelectedLogService(svc.name)} className="cursor-pointer">
            <ServiceRow
              name={svc.name}
              status={svc.status}
              uptime={svc.uptime}
              ports={svc.ports}
              onRestart={() => handleRestart(svc.name)}
              restarting={restartingService === svc.name}
            />
          </div>
        ))}
        {services.length === 0 && (
          <div className="text-gray-500 text-center py-8">No services found</div>
        )}
      </div>

      {selectedLogService && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Logs: {selectedLogService}</h3>
            <button
              onClick={() => setSelectedLogService(null)}
              className="text-sm text-gray-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="bg-gray-950 rounded-lg border border-gray-700 p-4 font-mono text-xs max-h-80 overflow-auto">
            {logsData?.logs.map((log, i) => (
              <div key={i} className="py-0.5">
                <span className="text-gray-500">{log.timestamp}</span>{' '}
                <span className="text-gray-300">{log.message}</span>
              </div>
            ))}
            {(!logsData || logsData.logs.length === 0) && (
              <span className="text-gray-500">No recent logs</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

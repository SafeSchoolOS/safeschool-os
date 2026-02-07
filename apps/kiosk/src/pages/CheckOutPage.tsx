import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';
import { kioskApi } from '../api/client';

export function CheckOutPage() {
  useKioskMode();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [visitors, setVisitors] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const search = async () => {
    try {
      const results = await kioskApi.get(`/visitors/active`);
      const filtered = results.filter((v: any) =>
        `${v.firstName} ${v.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
        v.badgeNumber?.toLowerCase().includes(query.toLowerCase())
      );
      setVisitors(filtered);
      setError(filtered.length === 0 ? 'No matching visitors found' : '');
    } catch {
      setError('Search failed');
    }
  };

  const handleCheckOut = async (id: string, name: string) => {
    try {
      await kioskApi.post(`/visitors/${id}/check-out`, {});
      setSuccess(`${name} has been checked out. Goodbye!`);
      setTimeout(() => navigate('/'), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-out failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white mb-8 text-lg">
        &larr; Back
      </button>

      <h2 className="text-4xl font-bold text-center mb-8">Visitor Check-Out</h2>

      {success && (
        <div className="bg-green-900 text-green-200 p-6 rounded-xl mb-6 text-center text-xl">{success}</div>
      )}

      {error && <div className="bg-red-900 text-red-200 p-4 rounded-xl mb-6 text-center">{error}</div>}

      <div className="max-w-lg mx-auto mb-8">
        <div className="flex gap-3">
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Enter badge number or name"
            className="flex-1 p-4 text-xl bg-gray-800 rounded-xl border border-gray-700 text-white"
            onKeyDown={e => e.key === 'Enter' && search()} />
          <button onClick={search}
            className="px-8 bg-blue-700 hover:bg-blue-600 rounded-xl text-xl transition-colors">
            Search
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto space-y-3">
        {visitors.map(v => (
          <button key={v.id} onClick={() => handleCheckOut(v.id, `${v.firstName} ${v.lastName}`)}
            className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-xl flex justify-between items-center transition-colors">
            <div>
              <div className="text-lg font-semibold">{v.firstName} {v.lastName}</div>
              <div className="text-sm text-gray-400">Badge: {v.badgeNumber} | {v.destination}</div>
            </div>
            <span className="text-red-400 text-lg">Check Out</span>
          </button>
        ))}
      </div>
    </div>
  );
}

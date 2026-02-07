import { useState } from 'react';
import { usePreRegisterVisitor, useCheckInVisitor } from '../../api/visitors';

export function VisitorCheckInForm() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const preRegister = usePreRegisterVisitor();
  const checkIn = useCheckInVisitor();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);

    try {
      const visitor = await preRegister.mutateAsync({ firstName, lastName, purpose, destination });
      const checked = await checkIn.mutateAsync(visitor.id);
      setResult(checked);
      setFirstName('');
      setLastName('');
      setPurpose('');
      setDestination('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4">Quick Check-In</h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="First Name"
            className="p-2 bg-gray-700 rounded border border-gray-600 text-white placeholder-gray-500"
            required
          />
          <input
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder="Last Name"
            className="p-2 bg-gray-700 rounded border border-gray-600 text-white placeholder-gray-500"
            required
          />
        </div>
        <input
          value={purpose}
          onChange={e => setPurpose(e.target.value)}
          placeholder="Purpose of Visit"
          className="w-full p-2 bg-gray-700 rounded border border-gray-600 text-white placeholder-gray-500"
          required
        />
        <input
          value={destination}
          onChange={e => setDestination(e.target.value)}
          placeholder="Destination (room or person)"
          className="w-full p-2 bg-gray-700 rounded border border-gray-600 text-white placeholder-gray-500"
          required
        />
        <button
          type="submit"
          disabled={preRegister.isPending || checkIn.isPending}
          className="w-full p-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded transition-colors font-medium"
        >
          {preRegister.isPending || checkIn.isPending ? 'Processing...' : 'Check In Visitor'}
        </button>
      </form>

      {error && <div className="mt-3 p-2 bg-red-900 text-red-200 rounded text-sm">{error}</div>}

      {result && (
        <div className="mt-3 p-3 bg-green-900 text-green-200 rounded">
          {result.status === 'CHECKED_IN' ? (
            <div>
              <div className="font-medium">Checked in successfully!</div>
              <div className="text-sm">Badge: {result.badgeNumber}</div>
            </div>
          ) : (
            <div className="text-red-300">Entry denied — screening flagged</div>
          )}
        </div>
      )}
    </div>
  );
}

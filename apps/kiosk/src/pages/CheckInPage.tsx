import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';
import { kioskApi } from '../api/client';

type Step = 'name' | 'purpose' | 'destination' | 'host';

export function CheckInPage() {
  useKioskMode();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('name');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');

  const purposes = ['Parent Visit', 'Vendor/Contractor', 'Meeting', 'Volunteer', 'Other'];
  const destinations = ['Main Office', 'Room 101', 'Room 102', 'Room 103', 'Room 104', 'Cafeteria', 'Gymnasium'];

  const handleSubmit = async () => {
    try {
      setError('');
      const visitor = await kioskApi.post('/visitors', {
        firstName,
        lastName,
        purpose,
        destination,
      });

      // Trigger check-in (which runs screening)
      const result = await kioskApi.post(`/visitors/${visitor.id}/check-in`, {});

      if (result.status === 'DENIED' || result.status === 'FLAGGED') {
        navigate('/denied');
      } else {
        navigate(`/badge/${result.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white mb-8 text-lg">
        &larr; Back
      </button>

      <h2 className="text-4xl font-bold text-center mb-8">Visitor Check-In</h2>

      {error && <div className="bg-red-900 text-red-200 p-4 rounded-xl mb-6 text-center text-lg">{error}</div>}

      {step === 'name' && (
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <label className="block text-lg mb-2">First Name</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              className="w-full p-4 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white" autoFocus />
          </div>
          <div>
            <label className="block text-lg mb-2">Last Name</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)}
              className="w-full p-4 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white" />
          </div>
          <button onClick={() => firstName && lastName && setStep('purpose')}
            disabled={!firstName || !lastName}
            className="w-full p-4 text-xl bg-green-700 hover:bg-green-600 disabled:bg-gray-700 rounded-xl transition-colors">
            Next
          </button>
        </div>
      )}

      {step === 'purpose' && (
        <div className="max-w-lg mx-auto space-y-4">
          <p className="text-xl text-center mb-4">Purpose of Visit</p>
          {purposes.map(p => (
            <button key={p} onClick={() => { setPurpose(p); setStep('destination'); }}
              className="w-full p-4 text-xl bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors">
              {p}
            </button>
          ))}
        </div>
      )}

      {step === 'destination' && (
        <div className="max-w-lg mx-auto space-y-4">
          <p className="text-xl text-center mb-4">Destination</p>
          {destinations.map(d => (
            <button key={d} onClick={() => { setDestination(d); handleSubmit(); }}
              className="w-full p-4 text-xl bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors">
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

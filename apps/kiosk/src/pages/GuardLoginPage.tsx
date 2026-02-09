import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kioskApi } from '../api/client';

export function GuardLoginPage() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    setError('');

    try {
      // Check guard console license first
      const siteId = import.meta.env.VITE_SITE_ID;
      if (siteId) {
        const features = await kioskApi.get(`/licenses/${siteId}/features`);
        if (!features.guardConsole) {
          setError('Guard Console requires a BadgeKiosk Professional license');
          setLoading(false);
          return;
        }
      }

      // Authenticate guard via standard login
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('safeschool_guard_token', data.token);
        navigate('/guard');
      } else {
        setError('Invalid PIN. Access denied.');
      }
    } catch {
      setError('Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (digit: string) => {
    if (digit === 'clear') {
      setPin('');
      return;
    }
    if (digit === 'back') {
      setPin(p => p.slice(0, -1));
      return;
    }
    if (pin.length < 8) {
      const next = pin + digit;
      setPin(next);
      if (next.length >= 4) {
        // Auto-submit on 4+ digits
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white p-8">
      <button onClick={() => navigate('/')} className="absolute top-6 left-6 text-gray-500 hover:text-white">
        &larr; Back
      </button>

      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">Guard Console</h2>
        <p className="text-gray-400">Enter your security PIN</p>
      </div>

      {error && (
        <div className="bg-red-900/50 text-red-300 px-6 py-3 rounded-xl mb-6 text-center">{error}</div>
      )}

      <div className="flex gap-2 mb-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-blue-500' : 'bg-gray-700'}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-xs">
        {['1','2','3','4','5','6','7','8','9','clear','0','back'].map(key => (
          <button
            key={key}
            onClick={() => handleKeyPress(key)}
            className={`w-20 h-20 rounded-2xl text-2xl font-bold transition-colors ${
              key === 'clear' ? 'bg-red-900/50 text-red-400 hover:bg-red-800/50 text-base' :
              key === 'back' ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 text-base' :
              'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            {key === 'back' ? '\u232B' : key === 'clear' ? 'CLR' : key}
          </button>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={pin.length < 4 || loading}
        className="mt-6 px-12 py-4 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 rounded-xl text-xl font-bold transition-colors"
      >
        {loading ? 'Verifying...' : 'Enter'}
      </button>
    </div>
  );
}

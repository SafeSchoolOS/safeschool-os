import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kioskApi, authLogin, GUARD_TOKEN_KEY } from '../api/client';

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
        try {
          const features = await kioskApi.get(`/licenses/${siteId}/features`);
          if (!features.guardConsole) {
            setError('Guard Console requires a BadgeKiosk Professional license');
            setLoading(false);
            return;
          }
        } catch {
          // License check may fail in dev -- allow through
        }
      }

      // Authenticate guard via standard login
      const data = await authLogin(pin);
      localStorage.setItem(GUARD_TOKEN_KEY, data.token);
      navigate('/guard');
    } catch {
      setError('Invalid PIN. Access denied.');
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
      setPin(pin + digit);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white p-8">
      <button
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 flex items-center gap-2 text-gray-500 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      <div className="text-center mb-8">
        {/* Lock icon */}
        <div className="flex justify-center mb-4">
          <svg className="w-16 h-16 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16" r="1" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold mb-2">Guard Console</h2>
        <p className="text-gray-400">Enter your security PIN</p>
      </div>

      {error && (
        <div className="bg-red-900/50 text-red-300 px-6 py-3 rounded-xl mb-6 text-center border border-red-800">
          {error}
        </div>
      )}

      {/* PIN dots */}
      <div className="flex gap-3 mb-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full transition-all duration-150 ${
              i < pin.length ? 'bg-blue-500 scale-110' : 'bg-gray-700'
            }`}
          />
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 max-w-xs">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map(key => (
          <button
            key={key}
            onClick={() => handleKeyPress(key)}
            className={`w-20 h-20 rounded-2xl text-2xl font-bold transition-all duration-150 active:scale-95 ${
              key === 'clear'
                ? 'bg-red-900/40 text-red-400 hover:bg-red-800/50 text-base'
                : key === 'back'
                  ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 text-base'
                  : 'bg-gray-800 hover:bg-gray-700 active:bg-gray-600'
            }`}
          >
            {key === 'back' ? '\u232B' : key === 'clear' ? 'CLR' : key}
          </button>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={pin.length < 4 || loading}
        className="mt-6 px-12 py-4 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl text-xl font-bold transition-all duration-200 active:scale-[0.98]"
      >
        {loading ? 'Verifying...' : 'Enter'}
      </button>
    </div>
  );
}

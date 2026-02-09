import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';
import { kioskApi } from '../api/client';

type Step = 'name' | 'purpose' | 'destination' | 'host' | 'submitting';

const STEPS: { key: Step; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'destination', label: 'Destination' },
  { key: 'host', label: 'Host' },
];

const PURPOSES = [
  'Parent Visit',
  'Vendor / Contractor',
  'Meeting',
  'Volunteer',
  'Delivery',
  'Emergency Contact',
  'Other',
];

const DESTINATIONS = [
  'Main Office',
  'Room 101',
  'Room 102',
  'Room 103',
  'Room 104',
  'Cafeteria',
  'Gymnasium',
  'Library',
  'Nurse\'s Office',
];

export function CheckInPage() {
  useKioskMode();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('name');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [hostName, setHostName] = useState('');
  const [error, setError] = useState('');

  const currentStepIndex = STEPS.findIndex(s => s.key === step);

  const handleSubmit = async (selectedHost: string) => {
    setStep('submitting');
    try {
      setError('');
      const visitor = await kioskApi.post('/visitors', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        purpose,
        destination,
        hostName: selectedHost || undefined,
      });

      // Trigger check-in (which runs screening)
      const result = await kioskApi.post(`/visitors/${visitor.id}/check-in`, {});

      if (result.status === 'DENIED' || result.status === 'FLAGGED') {
        navigate('/denied');
      } else {
        navigate(`/badge/${result.id || visitor.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
      setStep('name');
    }
  };

  const goBack = () => {
    if (step === 'name') {
      navigate('/');
    } else if (step === 'purpose') {
      setStep('name');
    } else if (step === 'destination') {
      setStep('purpose');
    } else if (step === 'host') {
      setStep('destination');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white p-8 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-lg transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h2 className="text-3xl font-bold">Visitor Check-In</h2>
        <div className="w-20" /> {/* Spacer for centering */}
      </div>

      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              i < currentStepIndex
                ? 'bg-green-600 text-white'
                : i === currentStepIndex
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400'
            }`}>
              {i < currentStepIndex ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-sm hidden sm:inline ${
              i === currentStepIndex ? 'text-white font-medium' : 'text-gray-500'
            }`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-0.5 ${i < currentStepIndex ? 'bg-green-600' : 'bg-gray-700'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="max-w-lg mx-auto bg-red-900/60 text-red-200 p-4 rounded-xl mb-6 text-center text-lg border border-red-800">
          {error}
        </div>
      )}

      <div className="flex-1 flex items-start justify-center pt-4">
        {/* Step 1: Name */}
        {step === 'name' && (
          <div className="max-w-lg w-full space-y-6">
            <p className="text-2xl text-center text-gray-300 mb-6">Please enter your name</p>
            <div>
              <label className="block text-lg mb-2 text-gray-300">First Name</label>
              <input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
                placeholder="Enter first name"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-lg mb-2 text-gray-300">Last Name</label>
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
                placeholder="Enter last name"
              />
            </div>
            <button
              onClick={() => firstName.trim() && lastName.trim() && setStep('purpose')}
              disabled={!firstName.trim() || !lastName.trim()}
              className="w-full p-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            >
              Next
            </button>
          </div>
        )}

        {/* Step 2: Purpose */}
        {step === 'purpose' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">What is the purpose of your visit?</p>
            {PURPOSES.map(p => (
              <button
                key={p}
                onClick={() => { setPurpose(p); setStep('destination'); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Step 3: Destination */}
        {step === 'destination' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">Where are you heading?</p>
            {DESTINATIONS.map(d => (
              <button
                key={d}
                onClick={() => { setDestination(d); setStep('host'); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {/* Step 4: Host */}
        {step === 'host' && (
          <div className="max-w-lg w-full space-y-6">
            <p className="text-2xl text-center text-gray-300 mb-6">Who are you visiting? (optional)</p>
            <input
              value={hostName}
              onChange={e => setHostName(e.target.value)}
              className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
              placeholder="Staff member name"
              autoFocus
            />
            <div className="flex gap-4">
              <button
                onClick={() => handleSubmit('')}
                className="flex-1 p-5 text-xl font-semibold bg-gray-700 hover:bg-gray-600 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                Skip
              </button>
              <button
                onClick={() => handleSubmit(hostName.trim())}
                disabled={!hostName.trim()}
                className="flex-1 p-5 text-xl font-semibold bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {/* Submitting state */}
        {step === 'submitting' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-8" />
            <h3 className="text-3xl font-bold mb-2">Processing Check-In</h3>
            <p className="text-gray-400 text-lg">Running background screening...</p>
          </div>
        )}
      </div>
    </div>
  );
}

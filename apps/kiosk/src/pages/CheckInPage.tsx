import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useKioskMode } from '../hooks/useKioskMode';
import { kioskApi } from '../api/client';

type Step = 'name' | 'purpose' | 'destination' | 'host' | 'submitting';

const STEP_KEYS: Step[] = ['name', 'purpose', 'destination', 'host'];

// Keys for purposes — these map to both translation keys and API values
const PURPOSE_KEYS = [
  'parentVisit',
  'vendor',
  'meeting',
  'volunteer',
  'delivery',
  'emergencyContact',
  'other',
] as const;

// The API values to send (English, regardless of UI language)
const PURPOSE_API_VALUES: Record<string, string> = {
  parentVisit: 'Parent Visit',
  vendor: 'Vendor / Contractor',
  meeting: 'Meeting',
  volunteer: 'Volunteer',
  delivery: 'Delivery',
  emergencyContact: 'Emergency Contact',
  other: 'Other',
};

const DESTINATION_KEYS = [
  'mainOffice',
  'room101',
  'room102',
  'room103',
  'room104',
  'cafeteria',
  'gymnasium',
  'library',
  'nursesOffice',
] as const;

const DESTINATION_API_VALUES: Record<string, string> = {
  mainOffice: 'Main Office',
  room101: 'Room 101',
  room102: 'Room 102',
  room103: 'Room 103',
  room104: 'Room 104',
  cafeteria: 'Cafeteria',
  gymnasium: 'Gymnasium',
  library: 'Library',
  nursesOffice: "Nurse's Office",
};

export function CheckInPage() {
  useKioskMode();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('name');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [hostName, setHostName] = useState('');
  const [error, setError] = useState('');

  const currentStepIndex = STEP_KEYS.indexOf(step);

  const stepLabels = [
    t('checkIn.step1Title'),
    t('checkIn.step2Title'),
    t('checkIn.step3Title'),
    t('checkIn.step4Title'),
  ];

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
        navigate(`/confirmed/${result.id || visitor.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkIn.errorDefault'));
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
          {t('common.back')}
        </button>
        <h2 className="text-3xl font-bold">{t('checkIn.header')}</h2>
        <div className="w-20" /> {/* Spacer for centering */}
      </div>

      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEP_KEYS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
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
              {stepLabels[i]}
            </span>
            {i < STEP_KEYS.length - 1 && (
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
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.enterName')}</p>
            <div>
              <label className="block text-lg mb-2 text-gray-300">{t('checkIn.firstName')}</label>
              <input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
                placeholder={t('checkIn.firstNamePlaceholder')}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-lg mb-2 text-gray-300">{t('checkIn.lastName')}</label>
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
                placeholder={t('checkIn.lastNamePlaceholder')}
              />
            </div>
            <button
              onClick={() => firstName.trim() && lastName.trim() && setStep('purpose')}
              disabled={!firstName.trim() || !lastName.trim()}
              className="w-full p-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            >
              {t('common.next')}
            </button>
          </div>
        )}

        {/* Step 2: Purpose */}
        {step === 'purpose' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.purposePrompt')}</p>
            {PURPOSE_KEYS.map(key => (
              <button
                key={key}
                onClick={() => { setPurpose(PURPOSE_API_VALUES[key]); setStep('destination'); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {t(`checkIn.purposes.${key}`)}
              </button>
            ))}
          </div>
        )}

        {/* Step 3: Destination */}
        {step === 'destination' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.destinationPrompt')}</p>
            {DESTINATION_KEYS.map(key => (
              <button
                key={key}
                onClick={() => { setDestination(DESTINATION_API_VALUES[key]); setStep('host'); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {t(`checkIn.destinations.${key}`)}
              </button>
            ))}
          </div>
        )}

        {/* Step 4: Host */}
        {step === 'host' && (
          <div className="max-w-lg w-full space-y-6">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.hostPrompt')}</p>
            <input
              value={hostName}
              onChange={e => setHostName(e.target.value)}
              className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
              placeholder={t('checkIn.hostPlaceholder')}
              autoFocus
            />
            <div className="flex gap-4">
              <button
                onClick={() => handleSubmit('')}
                className="flex-1 p-5 text-xl font-semibold bg-gray-700 hover:bg-gray-600 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('checkIn.skip')}
              </button>
              <button
                onClick={() => handleSubmit(hostName.trim())}
                disabled={!hostName.trim()}
                className="flex-1 p-5 text-xl font-semibold bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('common.submit')}
              </button>
            </div>
          </div>
        )}

        {/* Submitting state */}
        {step === 'submitting' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-8" />
            <h3 className="text-3xl font-bold mb-2">{t('checkIn.processingTitle')}</h3>
            <p className="text-gray-400 text-lg">{t('checkIn.processingMessage')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

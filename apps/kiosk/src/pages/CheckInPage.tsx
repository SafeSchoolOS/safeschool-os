import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { kioskApi } from '../api/client';

const SITE_ID = import.meta.env.VITE_SITE_ID || '';

type Step = 'name' | 'visitorType' | 'purpose' | 'destination' | 'host' | 'photo' | 'policy' | 'submitting';

const VISITOR_TYPE_KEYS = [
  'parent', 'visitor', 'contractor', 'vendor', 'volunteer',
  'substituteTeacher', 'delivery', 'emergencyContact',
] as const;

const VISITOR_TYPE_API: Record<string, string> = {
  parent: 'PARENT', visitor: 'VISITOR', contractor: 'CONTRACTOR',
  vendor: 'VENDOR', volunteer: 'VOLUNTEER', substituteTeacher: 'SUBSTITUTE_TEACHER',
  delivery: 'DELIVERY', emergencyContact: 'EMERGENCY_CONTACT',
};

const PURPOSE_KEYS = [
  'parentVisit', 'vendor', 'meeting', 'volunteer', 'delivery', 'emergencyContact', 'other',
] as const;

const PURPOSE_API_VALUES: Record<string, string> = {
  parentVisit: 'Parent Visit', vendor: 'Vendor / Contractor', meeting: 'Meeting',
  volunteer: 'Volunteer', delivery: 'Delivery', emergencyContact: 'Emergency Contact', other: 'Other',
};

const DESTINATION_KEYS = [
  'mainOffice', 'room101', 'room102', 'room103', 'room104',
  'cafeteria', 'gymnasium', 'library', 'nursesOffice',
] as const;

const DESTINATION_API_VALUES: Record<string, string> = {
  mainOffice: 'Main Office', room101: 'Room 101', room102: 'Room 102', room103: 'Room 103',
  room104: 'Room 104', cafeteria: 'Cafeteria', gymnasium: 'Gymnasium',
  library: 'Library', nursesOffice: "Nurse's Office",
};

interface SiteSettings {
  requireSignature: boolean;
  requirePhoto: boolean;
  requirePolicyAck: boolean;
  policies: { id: string; title: string; body: string }[];
}

export function CheckInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<Step>('name');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [visitorType, setVisitorType] = useState('VISITOR');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [hostName, setHostName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [policyAcked, setPolicyAcked] = useState(false);
  const [error, setError] = useState('');
  const [prefilledVisitorId, setPrefilledVisitorId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [CameraCaptureComp, setCameraCaptureComp] = useState<any>(null);
  const [SignaturePadComp, setSignaturePadComp] = useState<any>(null);
  const [PolicyAckComp, setPolicyAckComp] = useState<any>(null);

  // Load site settings
  useEffect(() => {
    if (SITE_ID) {
      kioskApi.get(`/visitor-settings/public/${SITE_ID}`)
        .then(setSettings)
        .catch(() => setSettings({ requireSignature: false, requirePhoto: false, requirePolicyAck: false, policies: [] }));
    } else {
      setSettings({ requireSignature: false, requirePhoto: false, requirePolicyAck: false, policies: [] });
    }
  }, []);

  // Handle QR pre-fill
  useEffect(() => {
    const visitorId = searchParams.get('visitorId');
    const qrToken = searchParams.get('qrToken');
    if (visitorId && qrToken) {
      kioskApi.get(`/visitors/qr/${qrToken}`).then((visitor: any) => {
        setFirstName(visitor.firstName);
        setLastName(visitor.lastName);
        if (visitor.purpose) setPurpose(visitor.purpose);
        if (visitor.destination) setDestination(visitor.destination);
        if (visitor.visitorType) setVisitorType(visitor.visitorType);
        setPrefilledVisitorId(visitor.id);
        // Skip to first incomplete step
        if (visitor.purpose && visitor.destination) {
          setStep('host');
        } else if (visitor.purpose) {
          setStep('destination');
        } else {
          setStep('visitorType');
        }
      }).catch(() => {
        // QR invalid, proceed normally
      });
    }
  }, [searchParams]);

  // Lazy load components
  useEffect(() => {
    if (settings?.requirePhoto) {
      import('../components/CameraCapture').then(m => setCameraCaptureComp(() => m.CameraCapture));
    }
    if (settings?.requireSignature) {
      import('../components/SignaturePad').then(m => setSignaturePadComp(() => m.SignaturePad));
    }
    if (settings?.requirePolicyAck && settings.policies.length > 0) {
      import('../components/PolicyAcknowledgment').then(m => setPolicyAckComp(() => m.PolicyAcknowledgment));
    }
  }, [settings]);

  // Build step list based on settings
  const getSteps = (): Step[] => {
    const steps: Step[] = ['name', 'visitorType', 'purpose', 'destination', 'host'];
    if (settings?.requirePhoto) steps.push('photo');
    if (settings?.requirePolicyAck && settings.policies.length > 0) steps.push('policy');
    return steps;
  };

  const steps = getSteps();
  const currentStepIndex = steps.indexOf(step);

  const stepLabels = steps.map(s => {
    switch (s) {
      case 'name': return t('checkIn.step1Title');
      case 'visitorType': return t('checkIn.stepVisitorType');
      case 'purpose': return t('checkIn.step2Title');
      case 'destination': return t('checkIn.step3Title');
      case 'host': return t('checkIn.step4Title');
      case 'photo': return t('checkIn.stepPhoto');
      case 'policy': return t('checkIn.stepPolicy');
      default: return '';
    }
  });

  const nextStep = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };

  const prevStep = () => {
    const idx = steps.indexOf(step);
    if (idx <= 0) navigate('/');
    else setStep(steps[idx - 1]);
  };

  const handleSubmit = async () => {
    setStep('submitting');
    try {
      setError('');

      let visitorId = prefilledVisitorId;

      if (!visitorId) {
        const visitor = await kioskApi.post('/visitors', {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          purpose,
          destination,
          visitorType,
          hostName: hostName || undefined,
        });
        visitorId = visitor.id;
      }

      const checkInData: any = {};
      if (photo) checkInData.photo = photo;
      if (signature) checkInData.signature = signature;
      if (policyAcked) checkInData.policyAckedAt = new Date().toISOString();

      const result = await kioskApi.post(`/visitors/${visitorId}/check-in`, checkInData);

      if (result.status === 'DENIED' || result.status === 'FLAGGED') {
        navigate('/denied');
      } else {
        navigate(`/confirmed/${result.id || visitorId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkIn.errorDefault'));
      setStep('name');
    }
  };

  const handleHostSubmit = (selectedHost: string) => {
    setHostName(selectedHost);
    const idx = steps.indexOf('host');
    if (idx < steps.length - 1) {
      setStep(steps[idx + 1]);
    } else {
      handleSubmit();
    }
  };

  const handlePhotoComplete = (base64: string) => {
    setPhoto(base64);
    const idx = steps.indexOf('photo');
    if (idx < steps.length - 1) {
      setStep(steps[idx + 1]);
    } else {
      handleSubmit();
    }
  };

  const handlePolicyComplete = () => {
    setPolicyAcked(true);
    // Policy is the last step before signature (if required)
    if (settings?.requireSignature && !signature) {
      // Show signature capture inline
      setStep('policy'); // stay on policy, show signature sub-step
    }
    handleSubmit();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white p-8 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={prevStep}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-lg transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('common.back')}
        </button>
        <h2 className="text-3xl font-bold">{t('checkIn.header')}</h2>
        <div className="w-20" />
      </div>

      {/* Progress indicator */}
      {step !== 'submitting' && (
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i < currentStepIndex
                  ? 'bg-green-600 text-white'
                  : i === currentStepIndex
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400'
              }`}>
                {i < currentStepIndex ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-xs hidden lg:inline ${
                i === currentStepIndex ? 'text-white font-medium' : 'text-gray-500'
              }`}>
                {stepLabels[i]}
              </span>
              {i < steps.length - 1 && (
                <div className={`w-6 h-0.5 ${i < currentStepIndex ? 'bg-green-600' : 'bg-gray-700'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="max-w-lg mx-auto bg-red-900/60 text-red-200 p-4 rounded-xl mb-6 text-center text-lg border border-red-800">
          {error}
        </div>
      )}

      <div className="flex-1 flex items-start justify-center pt-4">
        {/* Step: Name */}
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
              onClick={() => firstName.trim() && lastName.trim() && nextStep()}
              disabled={!firstName.trim() || !lastName.trim()}
              className="w-full p-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            >
              {t('common.next')}
            </button>
          </div>
        )}

        {/* Step: Visitor Type */}
        {step === 'visitorType' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.visitorTypePrompt')}</p>
            {VISITOR_TYPE_KEYS.map(key => (
              <button
                key={key}
                onClick={() => { setVisitorType(VISITOR_TYPE_API[key]); nextStep(); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {t(`checkIn.visitorTypes.${key}`)}
              </button>
            ))}
          </div>
        )}

        {/* Step: Purpose */}
        {step === 'purpose' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.purposePrompt')}</p>
            {PURPOSE_KEYS.map(key => (
              <button
                key={key}
                onClick={() => { setPurpose(PURPOSE_API_VALUES[key]); nextStep(); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {t(`checkIn.purposes.${key}`)}
              </button>
            ))}
          </div>
        )}

        {/* Step: Destination */}
        {step === 'destination' && (
          <div className="max-w-lg w-full space-y-3">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.destinationPrompt')}</p>
            {DESTINATION_KEYS.map(key => (
              <button
                key={key}
                onClick={() => { setDestination(DESTINATION_API_VALUES[key]); nextStep(); }}
                className="w-full p-5 text-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl transition-all duration-150 text-left border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
              >
                {t(`checkIn.destinations.${key}`)}
              </button>
            ))}
          </div>
        )}

        {/* Step: Host */}
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
                onClick={() => handleHostSubmit('')}
                className="flex-1 p-5 text-xl font-semibold bg-gray-700 hover:bg-gray-600 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('checkIn.skip')}
              </button>
              <button
                onClick={() => handleHostSubmit(hostName.trim())}
                disabled={!hostName.trim()}
                className="flex-1 p-5 text-xl font-semibold bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}

        {/* Step: Photo */}
        {step === 'photo' && CameraCaptureComp && (
          <div className="max-w-lg w-full">
            <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.photoPrompt')}</p>
            <CameraCaptureComp
              onCapture={handlePhotoComplete}
              onCancel={prevStep}
            />
          </div>
        )}

        {/* Step: Policy + Signature */}
        {step === 'policy' && PolicyAckComp && settings?.policies[0] && (
          <div className="max-w-lg w-full">
            {!policyAcked ? (
              <PolicyAckComp
                policyTitle={settings.policies[0].title}
                policyBody={settings.policies[0].body}
                onAcknowledge={() => {
                  setPolicyAcked(true);
                  if (settings.requireSignature && SignaturePadComp) {
                    // Stay on this step to show signature
                  } else {
                    handleSubmit();
                  }
                }}
                onCancel={prevStep}
              />
            ) : settings.requireSignature && SignaturePadComp && !signature ? (
              <div>
                <p className="text-2xl text-center text-gray-300 mb-6">{t('checkIn.signaturePrompt')}</p>
                <SignaturePadComp
                  onDone={(base64: string) => {
                    setSignature(base64);
                    handleSubmit();
                  }}
                  onCancel={() => setPolicyAcked(false)}
                />
              </div>
            ) : null}
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

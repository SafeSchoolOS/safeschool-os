import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { kioskApi } from '../api/client';

interface Visitor {
  id: string;
  firstName: string;
  lastName: string;
  destination?: string;
}

export function ConfirmedPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (id) {
      kioskApi.get(`/visitors/${id}`).then(setVisitor).catch(() => {});
    }
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col items-center justify-center text-white p-8">
      {/* Green checkmark */}
      <div className="w-24 h-24 bg-green-600 rounded-full flex items-center justify-center mb-8">
        <svg className="w-14 h-14 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 className="text-4xl font-bold mb-2">{t('confirmed.title', "You're All Set!")}</h1>

      {visitor && (
        <p className="text-2xl text-gray-300 mb-2">
          {t('confirmed.welcome', { name: `${visitor.firstName} ${visitor.lastName}`, defaultValue: `Welcome, ${visitor.firstName} ${visitor.lastName}` })}
        </p>
      )}

      {visitor?.destination && (
        <p className="text-lg text-gray-400 mb-4">
          {t('confirmed.destination', { dest: visitor.destination, defaultValue: `Destination: ${visitor.destination}` })}
        </p>
      )}

      <p className="text-xl text-gray-300 mb-8">
        {t('confirmed.instructions', 'Please proceed to the front desk.')}
      </p>

      <p className="text-sm text-gray-500">
        {t('confirmed.redirect', { seconds: countdown, defaultValue: `Returning to home in ${countdown}s` })}
      </p>

      <button
        onClick={() => navigate('/')}
        className="mt-6 px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-lg transition-colors"
      >
        {t('confirmed.done', 'Done')}
      </button>
    </div>
  );
}

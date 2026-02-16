import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { kioskApi } from '../api/client';

interface Visitor {
  id: string;
  firstName: string;
  lastName: string;
  badgeNumber?: string;
  destination?: string;
}

type PrintStatus = 'idle' | 'printing' | 'completed' | 'failed';

export function ConfirmedPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [printStatus, setPrintStatus] = useState<PrintStatus>('idle');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const printJobId = searchParams.get('printJobId');

  useEffect(() => {
    if (id) {
      kioskApi.get(`/visitors/${id}`).then(setVisitor).catch(() => {});
    }
  }, [id]);

  // Poll print job status if a printJobId was provided
  useEffect(() => {
    if (!printJobId) return;
    setPrintStatus('printing');

    pollRef.current = setInterval(async () => {
      try {
        const job = await kioskApi.get(`/badgekiosk/print/${printJobId}`);
        if (job.status === 'completed') {
          setPrintStatus('completed');
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (job.status === 'failed') {
          setPrintStatus('failed');
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Keep polling on transient errors
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [printJobId]);

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

      {visitor?.badgeNumber && (
        <p className="text-lg text-gray-400 mb-2">
          {t('confirmed.badge', { number: visitor.badgeNumber, defaultValue: `Badge #${visitor.badgeNumber}` })}
        </p>
      )}

      {visitor?.destination && (
        <p className="text-lg text-gray-400 mb-4">
          {t('confirmed.destination', { dest: visitor.destination, defaultValue: `Destination: ${visitor.destination}` })}
        </p>
      )}

      {/* Badge printing status */}
      {printJobId && (
        <div className="mb-6 flex items-center gap-3">
          {printStatus === 'printing' && (
            <>
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-blue-400">
                {t('confirmed.printing', 'Printing badge...')}
              </span>
            </>
          )}
          {printStatus === 'completed' && (
            <>
              <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-green-400">
                {t('confirmed.printComplete', 'Badge printed successfully')}
              </span>
            </>
          )}
          {printStatus === 'failed' && (
            <span className="text-yellow-400">
              {t('confirmed.printFailed', 'Badge print failed — please visit the front desk')}
            </span>
          )}
        </div>
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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QrScanner } from '../components/QrScanner';
import { kioskApi } from '../api/client';

type ScanState = 'scanning' | 'loading' | 'error';

export function QrScanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<ScanState>('scanning');
  const [errorMessage, setErrorMessage] = useState('');

  const handleScan = async (qrToken: string) => {
    if (state === 'loading') return;
    setState('loading');
    setErrorMessage('');

    try {
      const visitor = await kioskApi.get(`/visitors/qr/${encodeURIComponent(qrToken)}`);
      navigate(`/check-in?qrToken=${encodeURIComponent(qrToken)}&visitorId=${encodeURIComponent(visitor.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('qrScan.errorDefault', 'Visitor not found');
      setErrorMessage(message);
      setState('error');
    }
  };

  const handleRetry = () => {
    setErrorMessage('');
    setState('scanning');
  };

  const handleCancel = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white p-8 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={handleCancel}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-lg transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('common.back', 'Back')}
        </button>
        <h2 className="text-3xl font-bold">{t('qrScan.header', 'Scan QR Code')}</h2>
        <div className="w-20" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Scanning state */}
        {state === 'scanning' && (
          <div className="w-full max-w-md space-y-6">
            <p className="text-xl text-center text-gray-300 mb-4">
              {t('qrScan.instructions', 'Hold your QR code up to the camera')}
            </p>
            <div className="rounded-2xl overflow-hidden border-2 border-gray-700 bg-gray-800">
              <QrScanner onScan={handleScan} onCancel={handleCancel} />
            </div>
          </div>
        )}

        {/* Loading state */}
        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-8" />
            <h3 className="text-3xl font-bold mb-2">{t('qrScan.lookingUp', 'Looking up visitor...')}</h3>
            <p className="text-gray-400 text-lg">{t('qrScan.pleaseWait', 'Please wait')}</p>
          </div>
        )}

        {/* Error state */}
        {state === 'error' && (
          <div className="flex flex-col items-center justify-center py-16 max-w-md">
            <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <h3 className="text-3xl font-bold mb-3">{t('qrScan.errorTitle', 'Not Found')}</h3>
            <p className="text-gray-400 text-lg text-center mb-8">{errorMessage}</p>
            <div className="flex gap-4 w-full">
              <button
                onClick={handleCancel}
                className="flex-1 p-5 text-xl font-semibold bg-gray-700 hover:bg-gray-600 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={handleRetry}
                className="flex-1 p-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('qrScan.retry', 'Try Again')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

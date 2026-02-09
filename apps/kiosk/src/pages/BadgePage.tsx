import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useKioskMode } from '../hooks/useKioskMode';
import { kioskApi } from '../api/client';

const SITE_NAME = import.meta.env.VITE_SITE_NAME || 'Lincoln Elementary';

export function BadgePage() {
  useKioskMode(30000);
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [visitor, setVisitor] = useState<any>(null);
  const [features, setFeatures] = useState<any>(null);
  const [printing, setPrinting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);

  const currentLang = i18n.language?.split('-')[0] || 'en';
  const timeLocale = currentLang === 'es' ? 'es-US' : 'en-US';

  useEffect(() => {
    if (id) {
      kioskApi.get(`/visitors/${id}`).then(setVisitor).catch(() => navigate('/'));
    }
    // Check licensed features
    const siteId = import.meta.env.VITE_SITE_ID;
    if (siteId) {
      kioskApi.get(`/licenses/${siteId}/features`).then(setFeatures).catch(() => {});
    }
  }, [id, navigate]);

  const handlePrint = async () => {
    if (!features?.badgePrinting) {
      window.print();
      return;
    }

    setPrinting(true);
    try {
      const badge = await kioskApi.post(`/badges/${id}/generate`, { format: 'html' });
      const printWindow = window.open('', '_blank', 'width=300,height=500');
      if (printWindow) {
        printWindow.document.write(badge.html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      }
      await kioskApi.post(`/badges/${id}/print-job`, { copies: 1 }).catch(() => {});
      setPrintSuccess(true);
    } catch {
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  if (!visitor) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-400">{t('badge.loadingMessage')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col items-center justify-center text-white p-8">
      <div className="bg-white text-gray-900 rounded-3xl p-12 max-w-md w-full text-center shadow-2xl print:shadow-none print:rounded-none">
        {/* Success icon */}
        <div className="flex justify-center mb-4">
          <svg className="w-16 h-16 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <h2 className="text-3xl font-bold mb-1">{t('badge.title')}</h2>
        <p className="text-xl text-gray-600 mb-6">{visitor.firstName} {visitor.lastName}</p>

        <div className="bg-gray-50 rounded-xl p-6 mb-6 text-left space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-gray-500 text-sm">{t('badge.badgeNumber')}</span>
            <span className="font-bold text-2xl text-gray-900">{visitor.badgeNumber}</span>
          </div>
          <div className="h-px bg-gray-200" />
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">{t('badge.purpose')}</span>
            <span className="text-gray-800 font-medium">{visitor.purpose}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">{t('badge.destination')}</span>
            <span className="text-gray-800 font-medium">{visitor.destination}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">{t('badge.timeIn')}</span>
            <span className="text-gray-800 font-medium">
              {new Date(visitor.checkedInAt).toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        <div className="bg-blue-50 text-blue-800 rounded-lg p-3 mb-4 text-sm print:hidden">
          {t('badge.instructions', { siteName: SITE_NAME })}
        </div>

        <button
          onClick={handlePrint}
          disabled={printing}
          className="w-full p-4 bg-blue-600 text-white rounded-xl hover:bg-blue-500 active:bg-blue-700 transition-all duration-200 mb-3 disabled:bg-gray-400 print:hidden text-lg font-semibold active:scale-[0.98]"
        >
          {printing ? t('badge.printing') : printSuccess ? t('badge.printAnother') : t('badge.printBadge')}
        </button>

        {features?.badgePrinting && (
          <p className="text-xs text-green-600 print:hidden">{t('badge.printEnabled')}</p>
        )}
      </div>

      <button
        onClick={() => navigate('/')}
        className="mt-8 text-gray-400 hover:text-white text-lg print:hidden transition-colors"
      >
        {t('badge.done')}
      </button>
    </div>
  );
}

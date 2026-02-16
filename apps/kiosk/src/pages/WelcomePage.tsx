import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const SITE_NAME = import.meta.env.VITE_SITE_NAME || 'Lincoln Elementary';
const SITE_ID = import.meta.env.VITE_SITE_ID || '';
const API_BASE = import.meta.env.VITE_API_URL || '';
const LOGO_URL = SITE_ID ? `${API_BASE}/api/v1/sites/${SITE_ID}/logo` : '';

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
] as const;

export function WelcomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    const tick = () => setCurrentTime(new Date());
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    let interval: ReturnType<typeof setInterval>;
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, []);

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    try {
      localStorage.setItem('kiosk_language', langCode);
    } catch {
      // localStorage may not be available
    }
  };

  const currentLang = i18n.language?.split('-')[0] || 'en';

  const dateLocale = currentLang === 'es' ? 'es-US' : 'en-US';

  const dateStr = currentTime.toLocaleDateString(dateLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeStr = currentTime.toLocaleTimeString(dateLocale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 flex flex-col items-center justify-between text-white p-8 select-none">
      {/* Top bar with time and language toggle */}
      <div className="w-full flex justify-between items-center text-gray-400 text-lg">
        <span>{dateStr}</span>
        <div className="flex items-center gap-4">
          {/* Language toggle */}
          <div className="flex items-center bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
            {LANGUAGE_OPTIONS.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                  currentLang === lang.code
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
          <span className="text-2xl font-mono tabular-nums">{timeStr}</span>
        </div>
      </div>

      {/* Center content */}
      <div className="flex flex-col items-center justify-center flex-1">
        {/* School logo or fallback shield icon */}
        <div className="mb-6">
          {LOGO_URL && !logoError ? (
            <img
              src={LOGO_URL}
              alt="School logo"
              className="w-24 h-24 object-contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            <svg
              className="w-24 h-24 text-blue-500"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm-1 15l-4-4 1.41-1.41L11 14.17l5.59-5.59L18 10l-7 7z" />
            </svg>
          )}
        </div>

        <h1 className="text-5xl font-bold mb-2 text-center">{t('welcome.title')}</h1>
        <h2 className="text-6xl font-extrabold mb-4 text-center text-blue-400">{SITE_NAME}</h2>
        <p className="text-xl text-gray-400 mb-16">{t('welcome.subtitle')}</p>

        <div className="flex gap-6 flex-wrap justify-center">
          <button
            onClick={() => navigate('/check-in')}
            className="group w-56 h-56 bg-green-700 hover:bg-green-600 active:bg-green-800 rounded-3xl flex flex-col items-center justify-center text-2xl font-bold transition-all duration-200 shadow-lg shadow-green-900/40 hover:shadow-green-800/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-16 h-16 mb-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            {t('welcome.checkIn')}
          </button>

          <button
            onClick={() => navigate('/check-out')}
            className="group w-56 h-56 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 rounded-3xl flex flex-col items-center justify-center text-2xl font-bold transition-all duration-200 shadow-lg shadow-blue-900/40 hover:shadow-blue-800/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-16 h-16 mb-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {t('welcome.checkOut')}
          </button>

          <button
            onClick={() => navigate('/scan')}
            className="group w-56 h-56 bg-purple-700 hover:bg-purple-600 active:bg-purple-800 rounded-3xl flex flex-col items-center justify-center text-2xl font-bold transition-all duration-200 shadow-lg shadow-purple-900/40 hover:shadow-purple-800/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-16 h-16 mb-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            {t('welcome.scanQr')}
          </button>

          <button
            onClick={() => navigate('/group')}
            className="group w-56 h-56 bg-amber-700 hover:bg-amber-600 active:bg-amber-800 rounded-3xl flex flex-col items-center justify-center text-2xl font-bold transition-all duration-200 shadow-lg shadow-amber-900/40 hover:shadow-amber-800/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-16 h-16 mb-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {t('welcome.groupCheckIn')}
          </button>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-8 text-sm text-gray-600 select-none">
        {t('welcome.footer')}
      </p>
    </div>
  );
}

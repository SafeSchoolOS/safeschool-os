import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const SITE_NAME = import.meta.env.VITE_SITE_NAME || 'Lincoln Elementary';

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
] as const;

export function WelcomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // Update once per minute instead of per second to save CPU/battery on kiosk hardware
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
        {/* Shield icon */}
        <div className="mb-6">
          <svg
            className="w-24 h-24 text-blue-500"
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm-1 15l-4-4 1.41-1.41L11 14.17l5.59-5.59L18 10l-7 7z" />
          </svg>
        </div>

        <h1 className="text-5xl font-bold mb-2 text-center">{t('welcome.title')}</h1>
        <h2 className="text-6xl font-extrabold mb-4 text-center text-blue-400">{SITE_NAME}</h2>
        <p className="text-xl text-gray-400 mb-16">{t('welcome.subtitle')}</p>

        <div className="flex gap-8">
          <button
            onClick={() => navigate('/check-in')}
            className="group w-72 h-72 bg-green-700 hover:bg-green-600 active:bg-green-800 rounded-3xl flex flex-col items-center justify-center text-3xl font-bold transition-all duration-200 shadow-lg shadow-green-900/40 hover:shadow-green-800/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-20 h-20 mb-4 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            {t('welcome.checkIn')}
          </button>

          <button
            onClick={() => navigate('/check-out')}
            className="group w-72 h-72 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 rounded-3xl flex flex-col items-center justify-center text-3xl font-bold transition-all duration-200 shadow-lg shadow-blue-900/40 hover:shadow-blue-800/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-20 h-20 mb-4 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {t('welcome.checkOut')}
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

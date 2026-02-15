import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { kioskApi } from '../api/client';

export function CheckOutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [allVisitors, setAllVisitors] = useState<any[]>([]);
  const [filteredVisitors, setFilteredVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load active visitors on mount
  useEffect(() => {
    loadVisitors();
  }, []);

  const loadVisitors = async () => {
    setLoading(true);
    try {
      const results = await kioskApi.get('/visitors/active');
      setAllVisitors(results);
      setFilteredVisitors(results);
      setError('');
    } catch {
      setError(t('checkOut.errorLoad'));
    } finally {
      setLoading(false);
    }
  };

  // Filter locally as user types (debounced 300ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) {
        setFilteredVisitors(allVisitors);
      } else {
        const q = query.toLowerCase();
        setFilteredVisitors(
          allVisitors.filter(
            (v: any) =>
              `${v.firstName} ${v.lastName}`.toLowerCase().includes(q) ||
              v.badgeNumber?.toLowerCase().includes(q),
          ),
        );
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, allVisitors]);

  const handleCheckOut = async (id: string, name: string) => {
    try {
      await kioskApi.post(`/visitors/${id}/check-out`, {});
      setSuccess(t('checkOut.successMessage', { name }));
      setTimeout(() => navigate('/'), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkOut.errorDefault'));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-lg transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('common.back')}
        </button>
        <h2 className="text-3xl font-bold">{t('checkOut.header')}</h2>
        <div className="w-20" />
      </div>

      {success && (
        <div className="max-w-lg mx-auto bg-green-900/60 text-green-200 p-6 rounded-xl mb-6 text-center text-xl border border-green-800 flex flex-col items-center gap-3">
          <svg className="w-12 h-12 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {success}
        </div>
      )}

      {error && (
        <div className="max-w-lg mx-auto bg-red-900/60 text-red-200 p-4 rounded-xl mb-6 text-center border border-red-800">
          {error}
        </div>
      )}

      {!success && (
        <>
          {/* Search bar */}
          <div className="max-w-lg mx-auto mb-8">
            <p className="text-xl text-center text-gray-300 mb-4">{t('checkOut.searchPrompt')}</p>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('checkOut.searchPlaceholder')}
              className="w-full p-5 text-xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
              autoFocus
            />
          </div>

          {/* Visitor list */}
          <div className="max-w-lg mx-auto space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredVisitors.length === 0 ? (
              <div className="text-center text-gray-500 py-12 text-lg">
                {query ? t('checkOut.noMatchingVisitors') : t('checkOut.noActiveVisitors')}
              </div>
            ) : (
              filteredVisitors.map(v => (
                <button
                  key={v.id}
                  onClick={() => handleCheckOut(v.id, `${v.firstName} ${v.lastName}`)}
                  className="w-full p-5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl flex justify-between items-center transition-all duration-150 border border-gray-700 hover:border-gray-600 active:scale-[0.99]"
                >
                  <div className="text-left">
                    <div className="text-xl font-semibold">{v.firstName} {v.lastName}</div>
                    <div className="text-sm text-gray-400 mt-1">
                      {t('checkOut.badgeLabel')}: {v.badgeNumber} | {v.destination || v.purpose}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-red-400 text-lg font-medium">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    {t('checkOut.checkOutButton')}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

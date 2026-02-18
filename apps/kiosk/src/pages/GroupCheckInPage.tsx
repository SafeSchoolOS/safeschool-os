import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { kioskApi } from '../api/client';

interface GroupMember {
  id: string;
  firstName: string;
  lastName: string;
  purpose?: string;
}

interface GroupInfo {
  id: string;
  name: string;
  members: GroupMember[];
}

type PageState = 'search' | 'loading' | 'results' | 'checking-in' | 'success' | 'error';

export function GroupCheckInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setState('loading');
    setErrorMessage('');

    try {
      const result = await kioskApi.get(`/visitors/group/${encodeURIComponent(searchQuery.trim())}`);
      setGroup(result);
      setSelectedIds(new Set(result.members.map((m: GroupMember) => m.id)));
      setState('results');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('groupCheckIn.searchError', 'Group not found');
      setErrorMessage(message);
      setState('error');
    }
  };

  const toggleMember = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!group) return;
    if (selectedIds.size === group.members.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(group.members.map(m => m.id)));
    }
  };

  const handleCheckIn = async () => {
    if (!group || selectedIds.size === 0) return;
    setState('checking-in');
    setErrorMessage('');

    try {
      const result = await kioskApi.post(`/visitors/group/${encodeURIComponent(group.id)}/bulk-checkin`, {
        visitorIds: Array.from(selectedIds),
      });
      setCheckedInCount(result.checkedIn ?? selectedIds.size);
      setState('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('groupCheckIn.checkInError', 'Check-in failed');
      setErrorMessage(message);
      setState('error');
    }
  };

  const handleBack = () => {
    if (state === 'results') {
      setState('search');
      setGroup(null);
      setSelectedIds(new Set());
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white p-8 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-lg transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('common.back', 'Back')}
        </button>
        <h2 className="text-3xl font-bold">{t('groupCheckIn.header', 'Group Check-In')}</h2>
        <div className="w-20" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-start pt-4">
        {/* Search state */}
        {state === 'search' && (
          <div className="max-w-lg w-full space-y-6">
            <p className="text-2xl text-center text-gray-300 mb-6">
              {t('groupCheckIn.searchPrompt', 'Enter the group name to find members')}
            </p>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="w-full p-5 text-2xl bg-gray-800 rounded-xl border border-gray-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all"
              placeholder={t('groupCheckIn.searchPlaceholder', 'Group name...')}
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="w-full p-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            >
              {t('groupCheckIn.searchButton', 'Search')}
            </button>
          </div>
        )}

        {/* Loading state */}
        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-8" />
            <h3 className="text-3xl font-bold mb-2">{t('groupCheckIn.searching', 'Searching...')}</h3>
          </div>
        )}

        {/* Results state - member list */}
        {state === 'results' && group && (
          <div className="max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-2xl font-bold">{group.name}</h3>
              <span className="text-gray-400 text-lg">
                {t('groupCheckIn.memberCount', { count: group.members.length, defaultValue: `${group.members.length} members` })}
              </span>
            </div>

            {/* Select all toggle */}
            <button
              onClick={toggleAll}
              className="w-full p-4 text-lg bg-gray-800 hover:bg-gray-750 rounded-xl border border-gray-700 transition-colors flex items-center gap-3"
            >
              <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                selectedIds.size === group.members.length
                  ? 'bg-blue-600 border-blue-600'
                  : 'border-gray-500'
              }`}>
                {selectedIds.size === group.members.length && (
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span className="font-medium">{t('groupCheckIn.selectAll', 'Select All')}</span>
            </button>

            {/* Member list */}
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {group.members.map(member => (
                <button
                  key={member.id}
                  onClick={() => toggleMember(member.id)}
                  className="w-full p-4 text-lg bg-gray-800 hover:bg-gray-750 rounded-xl border border-gray-700 transition-colors flex items-center gap-3 text-left"
                >
                  <div className={`w-6 h-6 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    selectedIds.has(member.id)
                      ? 'bg-blue-600 border-blue-600'
                      : 'border-gray-500'
                  }`}>
                    {selectedIds.has(member.id) && (
                      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <span className="font-medium">{member.firstName} {member.lastName}</span>
                    {member.purpose && (
                      <span className="text-gray-400 text-sm ml-2">- {member.purpose}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Check in button */}
            <button
              onClick={handleCheckIn}
              disabled={selectedIds.size === 0}
              className="w-full p-5 text-xl font-semibold bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-all duration-200 active:scale-[0.98] mt-4"
            >
              {t('groupCheckIn.checkInSelected', {
                count: selectedIds.size,
                defaultValue: `Check In Selected (${selectedIds.size})`,
              })}
            </button>
          </div>
        )}

        {/* Checking in state */}
        {state === 'checking-in' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 border-4 border-green-400 border-t-transparent rounded-full animate-spin mb-8" />
            <h3 className="text-3xl font-bold mb-2">{t('groupCheckIn.processing', 'Checking in...')}</h3>
            <p className="text-gray-400 text-lg">{t('groupCheckIn.pleaseWait', 'Please wait')}</p>
          </div>
        )}

        {/* Success state */}
        {state === 'success' && (
          <div className="flex flex-col items-center justify-center py-16 max-w-md">
            <div className="w-24 h-24 bg-green-600 rounded-full flex items-center justify-center mb-8">
              <svg className="w-14 h-14 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-3xl font-bold mb-3">{t('groupCheckIn.successTitle', 'Group Checked In!')}</h3>
            <p className="text-gray-300 text-xl text-center mb-8">
              {t('groupCheckIn.successMessage', {
                count: checkedInCount,
                defaultValue: `${checkedInCount} visitors checked in successfully.`,
              })}
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-12 py-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            >
              {t('common.done', 'Done')}
            </button>
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
            <h3 className="text-3xl font-bold mb-3">{t('groupCheckIn.errorTitle', 'Error')}</h3>
            <p className="text-gray-400 text-lg text-center mb-8">{errorMessage}</p>
            <div className="flex gap-4 w-full">
              <button
                onClick={() => navigate('/')}
                className="flex-1 p-5 text-xl font-semibold bg-gray-700 hover:bg-gray-600 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => {
                  setErrorMessage('');
                  setState(group ? 'results' : 'search');
                }}
                className="flex-1 p-5 text-xl font-semibold bg-blue-600 hover:bg-blue-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
              >
                {t('groupCheckIn.retry', 'Try Again')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

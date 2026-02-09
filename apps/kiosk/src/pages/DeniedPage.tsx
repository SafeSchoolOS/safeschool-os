import { useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';

export function DeniedPage() {
  useKioskMode(15000);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-950 to-red-950/90 flex flex-col items-center justify-center text-white p-8">
      {/* Warning icon */}
      <div className="mb-8">
        <svg className="w-24 h-24 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>

      <h2 className="text-4xl font-bold mb-4">Entry Not Authorized</h2>
      <p className="text-xl text-red-200 mb-8 text-center max-w-md leading-relaxed">
        Your entry cannot be processed at this time. Please visit the main office for assistance.
      </p>

      <button
        onClick={() => navigate('/')}
        className="px-10 py-4 bg-red-800 hover:bg-red-700 active:bg-red-900 rounded-xl text-xl transition-all duration-200 active:scale-[0.98]"
      >
        Return to Welcome Screen
      </button>
    </div>
  );
}

import { useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';

export function DeniedPage() {
  useKioskMode(15000);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-red-950 flex flex-col items-center justify-center text-white p-8">
      <div className="text-8xl mb-8">&#9888;</div>
      <h2 className="text-4xl font-bold mb-4">Entry Not Authorized</h2>
      <p className="text-xl text-red-200 mb-8 text-center max-w-md">
        Your entry cannot be processed at this time. Please visit the main office for assistance.
      </p>
      <button onClick={() => navigate('/')}
        className="px-8 py-4 bg-red-800 hover:bg-red-700 rounded-xl text-xl transition-colors">
        Return to Welcome Screen
      </button>
    </div>
  );
}

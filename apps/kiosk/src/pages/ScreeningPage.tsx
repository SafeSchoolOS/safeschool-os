import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export function ScreeningPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    // The check-in API already ran screening; this page shows a brief "checking" state
    const timer = setTimeout(() => {
      navigate(`/badge/${id}`);
    }, 2000);
    return () => clearTimeout(timer);
  }, [id, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col items-center justify-center text-white">
      <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-8" />
      <h2 className="text-3xl font-bold mb-2">Verifying Identity...</h2>
      <p className="text-gray-400 text-lg">Please wait while we complete the screening process</p>
    </div>
  );
}

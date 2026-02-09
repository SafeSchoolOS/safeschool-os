import { useNavigate } from 'react-router-dom';

export function WelcomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white p-8">
      <h1 className="text-5xl font-bold mb-4">Welcome to Lincoln Elementary</h1>
      <p className="text-xl text-gray-400 mb-16">All visitors must sign in</p>

      <div className="flex gap-8">
        <button
          onClick={() => navigate('/check-in')}
          className="w-64 h-64 bg-green-700 hover:bg-green-600 rounded-3xl flex flex-col items-center justify-center text-3xl font-bold transition-colors"
        >
          <span className="text-6xl mb-4">+</span>
          Check In
        </button>

        <button
          onClick={() => navigate('/check-out')}
          className="w-64 h-64 bg-blue-700 hover:bg-blue-600 rounded-3xl flex flex-col items-center justify-center text-3xl font-bold transition-colors"
        >
          <span className="text-6xl mb-4">-</span>
          Check Out
        </button>
      </div>

      <p className="mt-16 text-sm text-gray-500">SafeSchool OS Visitor Management</p>
    </div>
  );
}

import { useAuth } from '../hooks/useAuth';
import { BusMap } from '../components/transportation/BusMap';
import { BusStatusGrid } from '../components/transportation/BusStatusGrid';

export function TransportationPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center gap-4">
        <a href="/" className="text-gray-400 hover:text-white transition-colors">&larr; Command Center</a>
        <h1 className="text-xl font-bold">Student Transportation</h1>
      </header>

      <div className="p-6 grid grid-cols-12 gap-6">
        <div className="col-span-8">
          <BusMap />
        </div>
        <div className="col-span-4">
          <BusStatusGrid />
        </div>
      </div>
    </div>
  );
}

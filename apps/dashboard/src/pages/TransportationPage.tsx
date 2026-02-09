import { BusMap } from '../components/transportation/BusMap';
import { BusStatusGrid } from '../components/transportation/BusStatusGrid';

export function TransportationPage() {
  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-8">
        <BusMap />
      </div>
      <div className="col-span-4">
        <BusStatusGrid />
      </div>
    </div>
  );
}

import { VisitorList } from '../components/visitors/VisitorList';
import { VisitorCheckInForm } from '../components/visitors/VisitorCheckInForm';

export function VisitorsPage() {
  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-8">
        <VisitorList />
      </div>
      <div className="col-span-4">
        <VisitorCheckInForm />
      </div>
    </div>
  );
}

import { VisitorList } from '../components/visitors/VisitorList';
import { VisitorCheckInForm } from '../components/visitors/VisitorCheckInForm';

export function VisitorsPage() {
  return (
    <div className="p-3 sm:p-6 grid grid-cols-12 gap-4 sm:gap-6">
      <div className="col-span-12 lg:col-span-8">
        <VisitorList />
      </div>
      <div className="col-span-12 lg:col-span-4">
        <VisitorCheckInForm />
      </div>
    </div>
  );
}

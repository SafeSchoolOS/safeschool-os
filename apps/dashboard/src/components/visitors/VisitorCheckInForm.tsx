import { useState } from 'react';
import { usePreRegisterVisitor, useCheckInVisitor } from '../../api/visitors';

const VISITOR_TYPES = [
  { value: 'VISITOR', label: 'Visitor' },
  { value: 'PARENT', label: 'Parent / Guardian' },
  { value: 'CONTRACTOR', label: 'Contractor' },
  { value: 'VENDOR', label: 'Vendor' },
  { value: 'VOLUNTEER', label: 'Volunteer' },
  { value: 'SUBSTITUTE_TEACHER', label: 'Substitute Teacher' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'EMERGENCY_CONTACT', label: 'Emergency Contact' },
] as const;

export function VisitorCheckInForm() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [visitorType, setVisitorType] = useState('VISITOR');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const preRegister = usePreRegisterVisitor();
  const checkIn = useCheckInVisitor();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);

    try {
      const visitor = await preRegister.mutateAsync({
        firstName,
        lastName,
        purpose,
        destination,
        visitorType,
        email: email || undefined,
        phone: phone || undefined,
        companyName: companyName || undefined,
        scheduledAt: scheduledAt || undefined,
      } as any);
      const checked = await checkIn.mutateAsync(visitor.id);
      setResult(checked);
      setFirstName('');
      setLastName('');
      setPurpose('');
      setDestination('');
      setVisitorType('VISITOR');
      setEmail('');
      setPhone('');
      setCompanyName('');
      setScheduledAt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    }
  };

  const inputClass = 'w-full p-2 dark:bg-gray-700 bg-gray-100 rounded border dark:border-gray-600 border-gray-300 dark:text-white text-gray-900 dark:placeholder-gray-500 placeholder-gray-400';

  return (
    <div className="dark:bg-gray-800 bg-white rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4">Quick Check-In</h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="First Name"
            className={inputClass}
            required
          />
          <input
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder="Last Name"
            className={inputClass}
            required
          />
        </div>

        <select
          value={visitorType}
          onChange={e => setVisitorType(e.target.value)}
          className={inputClass}
        >
          {VISITOR_TYPES.map(vt => (
            <option key={vt.value} value={vt.value}>{vt.label}</option>
          ))}
        </select>

        <input
          value={purpose}
          onChange={e => setPurpose(e.target.value)}
          placeholder="Purpose of Visit"
          className={inputClass}
          required
        />
        <input
          value={destination}
          onChange={e => setDestination(e.target.value)}
          placeholder="Destination (room or person)"
          className={inputClass}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email (optional)"
            type="email"
            className={inputClass}
          />
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            type="tel"
            className={inputClass}
          />
        </div>

        {(visitorType === 'CONTRACTOR' || visitorType === 'VENDOR') && (
          <input
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="Company Name"
            className={inputClass}
          />
        )}

        <input
          value={scheduledAt}
          onChange={e => setScheduledAt(e.target.value)}
          placeholder="Scheduled Visit (optional)"
          type="datetime-local"
          className={inputClass}
        />

        <button
          type="submit"
          disabled={preRegister.isPending || checkIn.isPending}
          className="w-full p-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded transition-colors font-medium text-white"
        >
          {preRegister.isPending || checkIn.isPending ? 'Processing...' : 'Check In Visitor'}
        </button>
      </form>

      {error && <div className="mt-3 p-2 bg-red-900 text-red-200 rounded text-sm">{error}</div>}

      {result && (
        <div className="mt-3 p-3 bg-green-900 text-green-200 rounded">
          {result.status === 'CHECKED_IN' ? (
            <div>
              <div className="font-medium">Checked in successfully!</div>
              <div className="text-sm">Badge: {result.badgeNumber}</div>
            </div>
          ) : (
            <div className="text-red-300">Entry denied — screening flagged</div>
          )}
        </div>
      )}
    </div>
  );
}

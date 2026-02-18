import { useState } from 'react';
import { useEvents, useCreateEvent, useDeleteEvent } from '../api/events';

const EVENT_TYPES = ['SPORTS', 'ASSEMBLY', 'CONCERT', 'PARENT_NIGHT', 'COMMUNITY', 'MAINTENANCE', 'OTHER_EVENT'];
const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'bg-blue-500/20 text-blue-400',
  ACTIVE_EVENT: 'bg-green-500/20 text-green-400',
  COMPLETED_EVENT: 'bg-gray-500/20 text-gray-400',
  CANCELLED_EVENT: 'bg-red-500/20 text-red-400',
};

export function EventsPage() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'SPORTS', startTime: '', endTime: '', description: '' });
  const { data: events, isLoading } = useEvents();
  const createEvent = useCreateEvent();
  const deleteEvent = useDeleteEvent();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createEvent.mutateAsync(form);
    setForm({ name: '', type: 'SPORTS', startTime: '', endTime: '', description: '' });
    setShowForm(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Event Scheduling</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500">Manage events with automated door access control</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          {showForm ? 'Cancel' : 'New Event'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="dark:bg-gray-800 bg-white rounded-lg p-6 space-y-4 border dark:border-gray-700 border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Event Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm">
                {EVENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Start Time</label>
              <input type="datetime-local" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} required className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Time</label>
              <input type="datetime-local" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} required className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
          </div>
          <button type="submit" disabled={createEvent.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
            {createEvent.isPending ? 'Creating...' : 'Create Event'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12 dark:text-gray-400 text-gray-500">Loading events...</div>
      ) : (
        <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="dark:bg-gray-700/50 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">End</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Doors</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
              {(events || []).map((event: any) => (
                <tr key={event.id} className="dark:hover:bg-gray-700/30 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{event.name}</td>
                  <td className="px-4 py-3">{event.type.replace('_', ' ')}</td>
                  <td className="px-4 py-3">{new Date(event.startTime).toLocaleString()}</td>
                  <td className="px-4 py-3">{new Date(event.endTime).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[event.status] || ''}`}>
                      {event.status.replace('_EVENT', '')}
                    </span>
                  </td>
                  <td className="px-4 py-3">{event.doorGrants?.length || 0}</td>
                  <td className="px-4 py-3">
                    {event.status === 'SCHEDULED' && (
                      <button onClick={() => deleteEvent.mutate(event.id)} className="text-red-400 hover:text-red-300 text-xs">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {(!events || events.length === 0) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center dark:text-gray-500 text-gray-400">No events scheduled</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

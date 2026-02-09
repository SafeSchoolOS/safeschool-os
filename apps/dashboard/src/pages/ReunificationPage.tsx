import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface ReunificationEvent {
  id: string;
  location: string;
  status: string;
  totalStudents: number;
  reunifiedCount: number;
  startedAt: string;
  completedAt?: string;
  _count?: { entries: number };
}

interface ReunificationEntry {
  id: string;
  studentName: string;
  studentGrade?: string;
  guardianName?: string;
  guardianIdType?: string;
  guardianIdCheck: boolean;
  releasedAt?: string;
  status: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-red-600',
  COMPLETED: 'bg-green-600',
  CANCELLED: 'bg-gray-600',
};

export function ReunificationPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newEvent, setNewEvent] = useState({ location: '', totalStudents: '' });
  const [newStudent, setNewStudent] = useState({ studentName: '', studentGrade: '' });

  const { data: events = [], isLoading } = useQuery<ReunificationEvent[]>({
    queryKey: ['reunification-events'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/reunification`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: eventDetail } = useQuery<ReunificationEvent & { entries: ReunificationEntry[] }>({
    queryKey: ['reunification-event', selectedEvent],
    enabled: !!selectedEvent,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/reunification/${selectedEvent}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { location: string; totalStudents?: number }) => {
      const res = await fetch(`${API_URL}/api/v1/reunification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create event');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reunification-events'] });
      setSelectedEvent(data.id);
      setShowCreateForm(false);
      setNewEvent({ location: '', totalStudents: '' });
    },
  });

  const addStudentMutation = useMutation({
    mutationFn: async (data: { studentName: string; studentGrade?: string }) => {
      const res = await fetch(`${API_URL}/api/v1/reunification/${selectedEvent}/entries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to add student');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunification-event', selectedEvent] });
      setNewStudent({ studentName: '', studentGrade: '' });
      setShowAddStudent(false);
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async ({ entryId, guardianName }: { entryId: string; guardianName: string }) => {
      const res = await fetch(`${API_URL}/api/v1/reunification/${selectedEvent}/entries/${entryId}/release`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guardianName, guardianIdCheck: true }),
      });
      if (!res.ok) throw new Error('Failed to release student');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunification-event', selectedEvent] });
      queryClient.invalidateQueries({ queryKey: ['reunification-events'] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_URL}/api/v1/reunification/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });
      if (!res.ok) throw new Error('Failed to complete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunification-events'] });
      queryClient.invalidateQueries({ queryKey: ['reunification-event', selectedEvent] });
    },
  });

  return (
    <div className="p-6">
      {/* Top Actions */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded text-sm font-medium transition-colors"
        >
          Start Reunification
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <div className="flex gap-6">
        {/* Events List */}
        <div className="w-1/3">
          {showCreateForm && (
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h3 className="font-semibold mb-3">New Reunification Event</h3>
              <input
                type="text"
                placeholder="Location (e.g., Football Field)"
                value={newEvent.location}
                onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm mb-2"
              />
              <input
                type="number"
                placeholder="Expected student count"
                value={newEvent.totalStudents}
                onChange={(e) => setNewEvent({ ...newEvent, totalStudents: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm mb-3"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => createMutation.mutate({
                    location: newEvent.location,
                    totalStudents: newEvent.totalStudents ? parseInt(newEvent.totalStudents) : undefined,
                  })}
                  disabled={!newEvent.location}
                  className="bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded text-sm disabled:opacity-50"
                >
                  Start
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-600 hover:bg-gray-700 px-3 py-1.5 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {events.map((event) => (
              <button
                key={event.id}
                onClick={() => setSelectedEvent(event.id)}
                className={`w-full text-left bg-gray-800 rounded-lg p-3 transition-colors ${selectedEvent === event.id ? 'ring-2 ring-blue-500' : 'hover:bg-gray-700'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`${STATUS_COLORS[event.status]} px-2 py-0.5 rounded text-xs font-bold`}>
                    {event.status}
                  </span>
                  <span className="text-xs text-gray-400">
                    {event.reunifiedCount}/{event.totalStudents}
                  </span>
                </div>
                <div className="font-medium text-sm">{event.location}</div>
                <div className="text-xs text-gray-400">{new Date(event.startedAt).toLocaleString()}</div>
              </button>
            ))}
            {!isLoading && events.length === 0 && (
              <div className="text-center text-gray-500 py-8 text-sm">No reunification events.</div>
            )}
          </div>
        </div>

        {/* Event Detail */}
        <div className="w-2/3">
          {eventDetail ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{eventDetail.location}</h2>
                  <div className="text-sm text-gray-400">
                    {eventDetail.reunifiedCount} of {eventDetail.totalStudents} reunified
                    {eventDetail.entries && ` | ${eventDetail.entries.length} checked in`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {eventDetail.status === 'ACTIVE' && (
                    <>
                      <button
                        onClick={() => setShowAddStudent(!showAddStudent)}
                        className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded text-sm"
                      >
                        Add Student
                      </button>
                      <button
                        onClick={() => completeMutation.mutate(eventDetail.id)}
                        className="bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-sm"
                      >
                        Complete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="bg-gray-700 rounded-full h-3 mb-4">
                <div
                  className="bg-green-500 rounded-full h-3 transition-all"
                  style={{ width: `${eventDetail.totalStudents ? (eventDetail.reunifiedCount / eventDetail.totalStudents) * 100 : 0}%` }}
                />
              </div>

              {showAddStudent && eventDetail.status === 'ACTIVE' && (
                <div className="bg-gray-800 rounded-lg p-4 mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Student Name"
                      value={newStudent.studentName}
                      onChange={(e) => setNewStudent({ ...newStudent, studentName: e.target.value })}
                      className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Grade"
                      value={newStudent.studentGrade}
                      onChange={(e) => setNewStudent({ ...newStudent, studentGrade: e.target.value })}
                      className="w-20 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => addStudentMutation.mutate(newStudent)}
                      disabled={!newStudent.studentName}
                      className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded text-sm disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Student Entries */}
              <div className="space-y-2">
                {(eventDetail.entries || []).map((entry) => (
                  <div key={entry.id} className="bg-gray-800 rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{entry.studentName}</span>
                      {entry.studentGrade && <span className="text-gray-400 text-sm ml-2">Grade {entry.studentGrade}</span>}
                      {entry.releasedAt && (
                        <span className="text-green-400 text-sm ml-2">
                          Released to {entry.guardianName} at {new Date(entry.releasedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    {entry.status !== 'RELEASED' && eventDetail.status === 'ACTIVE' && (
                      <button
                        onClick={() => {
                          const name = prompt('Guardian name:');
                          if (name) releaseMutation.mutate({ entryId: entry.id, guardianName: name });
                        }}
                        className="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-xs"
                      >
                        Release
                      </button>
                    )}
                    {entry.status === 'RELEASED' && (
                      <span className="text-green-500 text-xs font-bold">RELEASED</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-16">
              Select an event to view details, or start a new reunification.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

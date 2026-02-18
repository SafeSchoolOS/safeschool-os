import { useState } from 'react';
import { useActiveRollCall, useInitiateRollCall, useSubmitRollCallReport, useCompleteRollCall } from '../api/rollCall';
import { useAuth } from '../hooks/useAuth';

export function RollCallPage() {
  const { user } = useAuth();
  const { data: rollCall, isLoading } = useActiveRollCall();
  const initiate = useInitiateRollCall();
  const submitReport = useSubmitRollCallReport();
  const complete = useCompleteRollCall();

  const [incidentId, setIncidentId] = useState('');
  const [reportForm, setReportForm] = useState({
    roomId: '',
    studentsPresent: 0,
    studentsAbsent: 0,
    studentsMissing: '',
    studentsInjured: '',
    notes: '',
  });

  const isOperator = user?.role === 'OPERATOR' || user?.role === 'SITE_ADMIN' || user?.role === 'SUPER_ADMIN';

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentId) return;
    await initiate.mutateAsync({ incidentId });
    setIncidentId('');
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rollCall) return;
    await submitReport.mutateAsync({
      rollCallId: rollCall.id,
      roomId: reportForm.roomId,
      studentsPresent: reportForm.studentsPresent,
      studentsAbsent: reportForm.studentsAbsent,
      studentsMissing: reportForm.studentsMissing ? reportForm.studentsMissing.split(',').map(s => s.trim()) : [],
      studentsInjured: reportForm.studentsInjured ? reportForm.studentsInjured.split(',').map(s => s.trim()) : [],
      notes: reportForm.notes || undefined,
    });
  };

  const myReport = rollCall?.reports?.find((r: any) => r.user?.id === user?.id);
  const progressPercent = rollCall ? Math.round((rollCall.reportedClassrooms / Math.max(rollCall.totalClassrooms, 1)) * 100) : 0;
  const allMissing = rollCall?.reports?.flatMap((r: any) => r.studentsMissing || []) || [];
  const allInjured = rollCall?.reports?.flatMap((r: any) => r.studentsInjured || []) || [];

  if (isLoading) return <div className="p-6 text-center dark:text-gray-400 text-gray-500">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Roll Call / Accountability</h2>
        <p className="text-sm dark:text-gray-400 text-gray-500">Teacher accountability during lockdown incidents</p>
      </div>

      {!rollCall && isOperator && (
        <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-6">
          <h3 className="font-semibold mb-3">Initiate Roll Call</h3>
          <form onSubmit={handleInitiate} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Incident ID</label>
              <input value={incidentId} onChange={e => setIncidentId(e.target.value)} placeholder="Enter active incident ID" required className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            </div>
            <button type="submit" disabled={initiate.isPending} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50">
              {initiate.isPending ? 'Starting...' : 'Start Roll Call'}
            </button>
          </form>
          {initiate.isError && <p className="text-red-400 text-sm mt-2">{(initiate.error as any)?.message || 'Failed to initiate'}</p>}
        </div>
      )}

      {!rollCall && !isOperator && (
        <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-6 text-center">
          <p className="dark:text-gray-400 text-gray-500">No active roll call at this time.</p>
          <p className="text-sm dark:text-gray-500 text-gray-400 mt-1">When a roll call is initiated during an incident, you can report your classroom status here.</p>
        </div>
      )}

      {rollCall && (
        <>
          {/* Progress Dashboard */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
              <div className="text-2xl font-bold">{rollCall.reportedClassrooms}/{rollCall.totalClassrooms}</div>
              <div className="text-xs dark:text-gray-400 text-gray-500">Classrooms Reported</div>
              <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
              <div className="text-2xl font-bold">{rollCall.accountedStudents}/{rollCall.totalStudents}</div>
              <div className="text-xs dark:text-gray-400 text-gray-500">Students Accounted</div>
            </div>
            <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
              <div className="text-2xl font-bold text-red-400">{allMissing.length}</div>
              <div className="text-xs dark:text-gray-400 text-gray-500">Students Missing</div>
            </div>
            <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
              <div className="text-2xl font-bold text-orange-400">{allInjured.length}</div>
              <div className="text-xs dark:text-gray-400 text-gray-500">Students Injured</div>
            </div>
          </div>

          {/* Missing/Injured Alerts */}
          {(allMissing.length > 0 || allInjured.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allMissing.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <h4 className="font-semibold text-red-400 mb-2">Missing Students</h4>
                  <ul className="text-sm space-y-1">
                    {allMissing.map((name: string, i: number) => <li key={i}>{name}</li>)}
                  </ul>
                </div>
              )}
              {allInjured.length > 0 && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                  <h4 className="font-semibold text-orange-400 mb-2">Injured Students</h4>
                  <ul className="text-sm space-y-1">
                    {allInjured.map((name: string, i: number) => <li key={i}>{name}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Teacher Report Form */}
          {!myReport && !isOperator && (
            <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-6">
              <h3 className="font-semibold mb-3">Report Your Classroom</h3>
              <form onSubmit={handleSubmitReport} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Room ID</label>
                  <input value={reportForm.roomId} onChange={e => setReportForm(f => ({ ...f, roomId: e.target.value }))} required className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Students Present</label>
                    <input type="number" min="0" value={reportForm.studentsPresent} onChange={e => setReportForm(f => ({ ...f, studentsPresent: parseInt(e.target.value) || 0 }))} required className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Students Absent</label>
                    <input type="number" min="0" value={reportForm.studentsAbsent} onChange={e => setReportForm(f => ({ ...f, studentsAbsent: parseInt(e.target.value) || 0 }))} required className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Missing Student Names (comma-separated)</label>
                  <input value={reportForm.studentsMissing} onChange={e => setReportForm(f => ({ ...f, studentsMissing: e.target.value }))} className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Injured Student Names (comma-separated)</label>
                  <input value={reportForm.studentsInjured} onChange={e => setReportForm(f => ({ ...f, studentsInjured: e.target.value }))} className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea value={reportForm.notes} onChange={e => setReportForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
                </div>
                <button type="submit" disabled={submitReport.isPending} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
                  {submitReport.isPending ? 'Submitting...' : 'Submit Report'}
                </button>
              </form>
            </div>
          )}

          {myReport && !isOperator && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <p className="text-green-400 font-medium">Your report has been submitted.</p>
              <p className="text-sm mt-1">Room: {myReport.room?.name} | Present: {myReport.studentsPresent} | Absent: {myReport.studentsAbsent}</p>
            </div>
          )}

          {/* All Reports (Operator view) */}
          {isOperator && (
            <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200">
              <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700 border-gray-200">
                <h3 className="font-semibold">Reports ({rollCall.reports?.length || 0})</h3>
                {rollCall.status === 'ACTIVE_ROLLCALL' && (
                  <button onClick={() => complete.mutate(rollCall.id)} className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
                    Complete Roll Call
                  </button>
                )}
              </div>
              <div className="divide-y dark:divide-gray-700 divide-gray-200">
                {(rollCall.reports || []).map((r: any) => (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{r.user?.name}</span>
                        <span className="dark:text-gray-400 text-gray-500 text-sm ml-2">Room: {r.room?.name || r.room?.number}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-green-400">{r.studentsPresent} present</span>
                        <span className="dark:text-gray-500 text-gray-400 mx-1">|</span>
                        <span className="text-yellow-400">{r.studentsAbsent} absent</span>
                      </div>
                    </div>
                    {r.studentsMissing?.length > 0 && (
                      <div className="text-xs text-red-400 mt-1">Missing: {r.studentsMissing.join(', ')}</div>
                    )}
                    {r.studentsInjured?.length > 0 && (
                      <div className="text-xs text-orange-400 mt-1">Injured: {r.studentsInjured.join(', ')}</div>
                    )}
                  </div>
                ))}
                {(!rollCall.reports || rollCall.reports.length === 0) && (
                  <div className="px-4 py-8 text-center dark:text-gray-500 text-gray-400 text-sm">Waiting for teacher reports...</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

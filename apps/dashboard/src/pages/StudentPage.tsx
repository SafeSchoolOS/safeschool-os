import { useState, useRef } from 'react';
import { useSites } from '../api/sites';
import {
  useStudents,
  useCreateStudent,
  useUpdateStudent,
  useUploadStudentPhoto,
  useDeleteStudentPhoto,
  useLinkTransportCard,
  usePrintIdCard,
} from '../api/students';

const API_BASE = import.meta.env.VITE_API_URL || '';
const GRADES = ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

function StudentPhotoAvatar({ student, size = 'sm' }: { student: any; size?: 'sm' | 'lg' }) {
  const dim = size === 'lg' ? 'w-24 h-24' : 'w-10 h-10';
  const text = size === 'lg' ? 'text-2xl' : 'text-sm';

  if (student.photo) {
    const token = localStorage.getItem('safeschool_token');
    return (
      <img
        src={`${API_BASE}/api/v1/students/${student.id}/photo?token=${token}`}
        alt={`${student.firstName} ${student.lastName}`}
        className={`${dim} rounded-full object-cover`}
      />
    );
  }

  const initials = `${student.firstName?.[0] || ''}${student.lastName?.[0] || ''}`.toUpperCase();
  return (
    <div className={`${dim} rounded-full bg-blue-600 flex items-center justify-center ${text} font-semibold text-white`}>
      {initials}
    </div>
  );
}

export function StudentPage() {
  const { data: sites } = useSites();
  const site = sites?.[0];
  const buildings = site?.buildings || [];

  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  const { data: students = [], isLoading } = useStudents({
    search: search || undefined,
    grade: gradeFilter || undefined,
    buildingId: buildingFilter || undefined,
    isActive: activeFilter || undefined,
  });

  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();
  const uploadPhoto = useUploadStudentPhoto();
  const deletePhoto = useDeleteStudentPhoto();
  const linkCard = useLinkTransportCard();
  const printId = usePrintIdCard();

  // Create form state
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', studentNumber: '', grade: '',
    dateOfBirth: '', buildingId: '', roomId: '', medicalNotes: '', allergies: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createStudent.mutateAsync({
      firstName: formData.firstName,
      lastName: formData.lastName,
      studentNumber: formData.studentNumber,
      grade: formData.grade || undefined,
      dateOfBirth: formData.dateOfBirth || undefined,
      buildingId: formData.buildingId || undefined,
      roomId: formData.roomId || undefined,
      medicalNotes: formData.medicalNotes || undefined,
      allergies: formData.allergies || undefined,
    });
    setFormData({ firstName: '', lastName: '', studentNumber: '', grade: '', dateOfBirth: '', buildingId: '', roomId: '', medicalNotes: '', allergies: '' });
    setShowCreate(false);
  };

  const selectedBuilding = buildings.find((b: any) => b.id === formData.buildingId);
  const rooms = selectedBuilding?.rooms || [];

  const detail = selectedStudent ? students.find((s: any) => s.id === selectedStudent) : null;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold dark:text-white text-gray-900">Students</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500">
            {students.length} student{students.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg dark:bg-gray-800 bg-gray-200 p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-md text-sm ${viewMode === 'table' ? 'dark:bg-gray-700 bg-white dark:text-white text-gray-900 shadow-sm' : 'dark:text-gray-400 text-gray-500'}`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-md text-sm ${viewMode === 'grid' ? 'dark:bg-gray-700 bg-white dark:text-white text-gray-900 shadow-sm' : 'dark:text-gray-400 text-gray-500'}`}
            >
              Grid
            </button>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Add Student
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by name or student #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900 w-64 dark:placeholder-gray-500 placeholder-gray-400"
        />
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900"
        >
          <option value="">All Grades</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>Grade {g}</option>
          ))}
        </select>
        <select
          value={buildingFilter}
          onChange={(e) => setBuildingFilter(e.target.value)}
          className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900"
        >
          <option value="">All Buildings</option>
          {buildings.map((b: any) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900"
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
          <option value="">All</option>
        </select>
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold dark:text-white text-gray-900">New Student</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input required placeholder="First Name" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" />
            <input required placeholder="Last Name" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" />
            <input required placeholder="Student # (e.g. STU-2026-001)" value={formData.studentNumber} onChange={(e) => setFormData({ ...formData, studentNumber: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" />
            <select value={formData.grade} onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900">
              <option value="">Grade</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input type="date" placeholder="Date of Birth" value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" />
            <select value={formData.buildingId} onChange={(e) => setFormData({ ...formData, buildingId: e.target.value, roomId: '' })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900">
              <option value="">Building</option>
              {buildings.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {rooms.length > 0 && (
              <select value={formData.roomId} onChange={(e) => setFormData({ ...formData, roomId: e.target.value })}
                className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900">
                <option value="">Room</option>
                {rooms.map((r: any) => <option key={r.id} value={r.id}>{r.number} - {r.name}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <textarea placeholder="Medical Notes" value={formData.medicalNotes} onChange={(e) => setFormData({ ...formData, medicalNotes: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" rows={2} />
            <textarea placeholder="Allergies" value={formData.allergies} onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
              className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" rows={2} />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={createStudent.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {createStudent.isPending ? 'Creating...' : 'Create Student'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="dark:text-gray-400 text-gray-500 hover:dark:text-white hover:text-gray-900 px-4 py-2 text-sm">Cancel</button>
          </div>
          {createStudent.error && <p className="text-red-400 text-sm">{(createStudent.error as Error).message}</p>}
        </form>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Table View */}
      {!isLoading && viewMode === 'table' && (
        <div className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="dark:bg-gray-750 bg-gray-50 dark:border-gray-700 border-gray-200 border-b text-left">
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Student</th>
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Student #</th>
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Grade</th>
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Classroom</th>
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Cards</th>
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-medium dark:text-gray-400 text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
              {students.map((student: any) => (
                <tr key={student.id} className="dark:hover:bg-gray-750 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StudentPhotoAvatar student={student} />
                      <div>
                        <div className="font-medium dark:text-white text-gray-900 text-sm">
                          {student.firstName} {student.lastName}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm dark:text-gray-300 text-gray-600">{student.studentNumber}</td>
                  <td className="px-4 py-3 text-sm dark:text-gray-300 text-gray-600">{student.grade || '—'}</td>
                  <td className="px-4 py-3 text-sm dark:text-gray-300 text-gray-600">
                    {student.room ? `${student.room.number} - ${student.room.name}` : student.building?.name || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm dark:text-gray-300 text-gray-600">{student._count?.transportCards || 0}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs rounded-full ${
                      student.isActive
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-gray-500/20 dark:text-gray-400 text-gray-500'
                    }`}>
                      {student.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedStudent(selectedStudent === student.id ? null : student.id)}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      {selectedStudent === student.id ? 'Close' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center dark:text-gray-500 text-gray-400">
                    No students found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid View */}
      {!isLoading && viewMode === 'grid' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {students.map((student: any) => (
            <button
              key={student.id}
              onClick={() => setSelectedStudent(selectedStudent === student.id ? null : student.id)}
              className={`dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border rounded-xl p-4 text-left hover:dark:border-gray-600 hover:border-gray-300 transition-colors ${
                selectedStudent === student.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <StudentPhotoAvatar student={student} size="lg" />
                <div className="text-center">
                  <div className="font-medium dark:text-white text-gray-900 text-sm">
                    {student.firstName} {student.lastName}
                  </div>
                  <div className="text-xs dark:text-gray-400 text-gray-500">
                    {student.grade ? `Grade ${student.grade}` : ''}
                    {student.room ? ` | ${student.room.number}` : ''}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Student Detail Panel */}
      {detail && <StudentDetailPanel student={detail} buildings={buildings} onClose={() => setSelectedStudent(null)}
        updateStudent={updateStudent} uploadPhoto={uploadPhoto} deletePhoto={deletePhoto}
        linkCard={linkCard} printId={printId} />}
    </div>
  );
}

function StudentDetailPanel({ student, buildings, onClose, updateStudent, uploadPhoto, deletePhoto, linkCard, printId }: any) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [newCardId, setNewCardId] = useState('');

  const startEdit = () => {
    setEditData({
      firstName: student.firstName,
      lastName: student.lastName,
      grade: student.grade || '',
      buildingId: student.buildingId || '',
      roomId: student.roomId || '',
      medicalNotes: student.medicalNotes || '',
      allergies: student.allergies || '',
      notes: student.notes || '',
      isActive: student.isActive,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    await updateStudent.mutateAsync({ id: student.id, ...editData });
    setEditing(false);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadPhoto.mutateAsync({ id: student.id, file });
  };

  const handleLinkCard = async () => {
    if (!newCardId.trim()) return;
    await linkCard.mutateAsync({ id: student.id, cardId: newCardId.trim() });
    setNewCardId('');
  };

  const handlePrint = () => printId.mutate(student.id);

  const editBuilding = buildings.find((b: any) => b.id === editData.buildingId);
  const editRooms = editBuilding?.rooms || [];

  return (
    <div className="dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border rounded-xl p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <StudentPhotoAvatar student={student} size="lg" />
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs transition-opacity"
            >
              Upload
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePhotoUpload} />
          </div>
          <div>
            <h3 className="text-xl font-bold dark:text-white text-gray-900">{student.firstName} {student.lastName}</h3>
            <p className="text-sm dark:text-gray-400 text-gray-500">{student.studentNumber}</p>
            {student.grade && <p className="text-sm dark:text-gray-400 text-gray-500">Grade {student.grade}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {student.photo && (
            <button onClick={() => deletePhoto.mutate(student.id)}
              className="text-red-400 hover:text-red-300 text-sm px-3 py-1">Remove Photo</button>
          )}
          {!editing && (
            <button onClick={startEdit} className="text-blue-400 hover:text-blue-300 text-sm px-3 py-1.5 dark:bg-gray-700 bg-gray-100 rounded-lg">
              Edit
            </button>
          )}
          <button onClick={onClose} className="dark:text-gray-400 text-gray-500 hover:dark:text-white hover:text-gray-900 text-sm px-3 py-1">Close</button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="space-y-4 dark:bg-gray-750 bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input value={editData.firstName} onChange={(e) => setEditData({ ...editData, firstName: e.target.value })} placeholder="First Name"
              className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" />
            <input value={editData.lastName} onChange={(e) => setEditData({ ...editData, lastName: e.target.value })} placeholder="Last Name"
              className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" />
            <select value={editData.grade} onChange={(e) => setEditData({ ...editData, grade: e.target.value })}
              className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900">
              <option value="">Grade</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={editData.buildingId} onChange={(e) => setEditData({ ...editData, buildingId: e.target.value, roomId: '' })}
              className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900">
              <option value="">Building</option>
              {buildings.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {editRooms.length > 0 && (
              <select value={editData.roomId} onChange={(e) => setEditData({ ...editData, roomId: e.target.value })}
                className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900">
                <option value="">Room</option>
                {editRooms.map((r: any) => <option key={r.id} value={r.id}>{r.number} - {r.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm dark:text-gray-300 text-gray-600">
              <input type="checkbox" checked={editData.isActive} onChange={(e) => setEditData({ ...editData, isActive: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <textarea value={editData.medicalNotes} onChange={(e) => setEditData({ ...editData, medicalNotes: e.target.value })} placeholder="Medical Notes"
              className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" rows={2} />
            <textarea value={editData.allergies} onChange={(e) => setEditData({ ...editData, allergies: e.target.value })} placeholder="Allergies"
              className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900" rows={2} />
          </div>
          <textarea value={editData.notes} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} placeholder="Notes"
            className="dark:bg-gray-700 bg-white dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900 w-full" rows={2} />
          <div className="flex gap-3">
            <button onClick={saveEdit} disabled={updateStudent.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {updateStudent.isPending ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="dark:text-gray-400 text-gray-500 text-sm px-4 py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Info sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Medical info */}
        {(student.medicalNotes || student.allergies) && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold dark:text-gray-300 text-gray-600 uppercase">Medical</h4>
            {student.medicalNotes && (
              <p className="text-sm dark:text-gray-400 text-gray-500"><span className="dark:text-gray-300 text-gray-600 font-medium">Notes:</span> {student.medicalNotes}</p>
            )}
            {student.allergies && (
              <p className="text-sm text-red-400"><span className="font-medium">Allergies:</span> {student.allergies}</p>
            )}
          </div>
        )}

        {/* Parent contacts */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold dark:text-gray-300 text-gray-600 uppercase">Parent Contacts ({student.parentContacts?.length || 0})</h4>
          {student.parentContacts?.map((pc: any) => (
            <div key={pc.id} className="text-sm dark:text-gray-400 text-gray-500">
              <span className="dark:text-gray-300 text-gray-600 font-medium">{pc.parentName}</span> ({pc.relationship})
              {pc.phone && <span className="ml-2">{pc.phone}</span>}
              {pc.email && <span className="ml-2">{pc.email}</span>}
            </div>
          ))}
          {(!student.parentContacts || student.parentContacts.length === 0) && (
            <p className="text-sm dark:text-gray-500 text-gray-400">No parent contacts linked</p>
          )}
        </div>
      </div>

      {/* Transport Cards */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold dark:text-gray-300 text-gray-600 uppercase">Transport Cards ({student.transportCards?.length || 0})</h4>
        {student.transportCards?.map((card: any) => (
          <div key={card.id} className="flex items-center justify-between dark:bg-gray-750 bg-gray-50 rounded-lg px-4 py-2">
            <div className="text-sm">
              <span className="dark:text-white text-gray-900 font-medium">{card.cardId}</span>
              <span className={`ml-2 text-xs ${card.isActive ? 'text-green-400' : 'dark:text-gray-500 text-gray-400'}`}>
                {card.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={newCardId}
            onChange={(e) => setNewCardId(e.target.value)}
            placeholder="Card ID (e.g. RFID-003-2026)"
            className="dark:bg-gray-700 bg-gray-50 dark:border-gray-600 border-gray-300 border rounded-lg px-3 py-2 text-sm dark:text-white text-gray-900 flex-1"
          />
          <button onClick={handleLinkCard} disabled={!newCardId.trim() || linkCard.isPending}
            className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            {linkCard.isPending ? 'Linking...' : 'Link Card'}
          </button>
        </div>
        {linkCard.error && <p className="text-red-400 text-sm">{(linkCard.error as Error).message}</p>}
      </div>

      {/* Print ID Card */}
      <div className="flex items-center gap-4 pt-2 dark:border-gray-700 border-gray-200 border-t">
        <button onClick={handlePrint} disabled={printId.isPending}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {printId.isPending ? 'Printing...' : 'Print ID Card'}
        </button>
        {printId.isSuccess && <span className="text-green-400 text-sm">Print job submitted</span>}
        {printId.error && <span className="text-red-400 text-sm">{(printId.error as Error).message}</span>}
      </div>
    </div>
  );
}

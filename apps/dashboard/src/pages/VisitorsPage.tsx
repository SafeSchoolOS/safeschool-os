import { useState } from 'react';
import { VisitorList } from '../components/visitors/VisitorList';
import { VisitorCheckInForm } from '../components/visitors/VisitorCheckInForm';
import { useVisitors, useCreateVisitorGroup } from '../api/visitors';

type Tab = 'active' | 'all' | 'groups';

export function VisitorsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [groupName, setGroupName] = useState('');
  const [groupPurpose, setGroupPurpose] = useState('');
  const [groupCount, setGroupCount] = useState(5);
  const [groupError, setGroupError] = useState('');
  const [groupSuccess, setGroupSuccess] = useState('');

  const { data: allVisitors } = useVisitors(undefined, tab === 'active' ? 'CHECKED_IN' : undefined);
  const createGroup = useCreateVisitorGroup();

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupError('');
    setGroupSuccess('');
    try {
      await createGroup.mutateAsync({
        name: groupName,
        purpose: groupPurpose,
        totalCount: groupCount,
        visitors: Array.from({ length: groupCount }, (_, i) => ({
          firstName: `Member ${i + 1}`,
          lastName: groupName,
          purpose: groupPurpose,
        })),
      });
      setGroupSuccess(`Group "${groupName}" created with ${groupCount} members`);
      setGroupName('');
      setGroupPurpose('');
      setGroupCount(5);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Failed to create group');
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: 'Active Visitors' },
    { key: 'all', label: 'All Visitors' },
    { key: 'groups', label: 'Groups' },
  ];

  return (
    <div className="p-3 sm:p-6">
      {/* Tab bar */}
      <div className="flex gap-1 mb-4 dark:bg-gray-800 bg-gray-200 rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? 'dark:bg-gray-700 bg-white dark:text-white text-gray-900 shadow-sm'
                : 'dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'groups' ? (
        <div className="grid grid-cols-12 gap-4 sm:gap-6">
          <div className="col-span-12 lg:col-span-8">
            <div className="dark:bg-gray-800 bg-white rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-4">Visitor Groups</h3>
              {allVisitors && allVisitors.length > 0 ? (
                <div className="space-y-2">
                  {/* Show unique groups from visitors that have groupId */}
                  {Array.from(new Set(allVisitors.filter((v: any) => v.groupId).map((v: any) => v.groupId))).map((gid: any) => {
                    const members = allVisitors.filter((v: any) => v.groupId === gid);
                    const group = members[0]?.group;
                    return (
                      <div key={gid} className="dark:bg-gray-700 bg-gray-50 rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-medium">{group?.name || 'Unknown Group'}</span>
                            <span className="dark:text-gray-400 text-gray-500 text-sm ml-2">{group?.purpose}</span>
                          </div>
                          <span className="text-sm dark:text-gray-400 text-gray-500">{members.length} members</span>
                        </div>
                      </div>
                    );
                  })}
                  {allVisitors.filter((v: any) => v.groupId).length === 0 && (
                    <p className="dark:text-gray-500 text-gray-400 text-sm">No visitor groups found</p>
                  )}
                </div>
              ) : (
                <p className="dark:text-gray-500 text-gray-400 text-sm">No visitor groups found</p>
              )}
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <div className="dark:bg-gray-800 bg-white rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-4">Create Group</h3>
              <form onSubmit={handleCreateGroup} className="space-y-3">
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group Name (e.g. Field Trip)"
                  className="w-full p-2 dark:bg-gray-700 bg-gray-100 rounded border dark:border-gray-600 border-gray-300 dark:text-white text-gray-900 dark:placeholder-gray-500 placeholder-gray-400"
                  required
                />
                <input
                  value={groupPurpose}
                  onChange={(e) => setGroupPurpose(e.target.value)}
                  placeholder="Purpose"
                  className="w-full p-2 dark:bg-gray-700 bg-gray-100 rounded border dark:border-gray-600 border-gray-300 dark:text-white text-gray-900 dark:placeholder-gray-500 placeholder-gray-400"
                  required
                />
                <div>
                  <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">Number of Members</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={groupCount}
                    onChange={(e) => setGroupCount(parseInt(e.target.value) || 1)}
                    className="w-full p-2 dark:bg-gray-700 bg-gray-100 rounded border dark:border-gray-600 border-gray-300 dark:text-white text-gray-900"
                  />
                </div>
                <button
                  type="submit"
                  disabled={createGroup.isPending}
                  className="w-full p-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 rounded transition-colors font-medium text-white"
                >
                  {createGroup.isPending ? 'Creating...' : 'Create Group'}
                </button>
              </form>
              {groupError && <div className="mt-3 p-2 bg-red-900 text-red-200 rounded text-sm">{groupError}</div>}
              {groupSuccess && <div className="mt-3 p-2 bg-green-900 text-green-200 rounded text-sm">{groupSuccess}</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4 sm:gap-6">
          <div className="col-span-12 lg:col-span-8">
            <VisitorList />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <VisitorCheckInForm />
          </div>
        </div>
      )}
    </div>
  );
}

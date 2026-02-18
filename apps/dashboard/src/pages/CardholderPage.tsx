import { useState } from 'react';
import { useCardholders, useCreateCardholder, useProvisionCredential, useRevokeCredential, useAccessZones, useCreateZone } from '../api/cardholders';

const CARD_FORMATS = [
  { value: 'H10301', label: '26-bit Wiegand (H10301)', bits: 26 },
  { value: 'H10304', label: '37-bit (H10304)', bits: 37 },
  { value: 'CORP1000', label: 'Corporate 1000 (35-bit)', bits: 35 },
  { value: 'ICLASS', label: 'HID iCLASS', bits: null },
  { value: 'MIFARE', label: 'MIFARE Classic', bits: null },
  { value: 'SEOS', label: 'HID SEOS', bits: null },
  { value: 'DESFIRE', label: 'MIFARE DESFire', bits: null },
  { value: 'CUSTOM', label: 'Custom', bits: null },
] as const;

const PERSON_TYPES = ['ALL', 'STAFF', 'STUDENT', 'WORKER', 'VISITOR'] as const;
const CREDENTIAL_TYPES = ['PHYSICAL_CARD', 'MOBILE', 'TEMPORARY_CARD', 'FOB'] as const;

const TYPE_COLORS: Record<string, string> = {
  STAFF: 'bg-blue-500/20 text-blue-400',
  STUDENT: 'bg-green-500/20 text-green-400',
  WORKER: 'bg-yellow-500/20 text-yellow-400',
  VISITOR: 'bg-purple-500/20 text-purple-400',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/20 text-green-400',
  SUSPENDED: 'bg-yellow-500/20 text-yellow-400',
  EXPIRED: 'bg-gray-500/20 text-gray-400',
  REVOKED: 'bg-red-500/20 text-red-400',
};

export function CardholderPage() {
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showCredForm, setShowCredForm] = useState<string | null>(null);
  const [showZones, setShowZones] = useState(false);
  const [showZoneForm, setShowZoneForm] = useState(false);

  const { data: cardholders, isLoading } = useCardholders({
    personType: activeTab === 'ALL' ? undefined : activeTab,
    search: search || undefined,
  });
  const { data: zones } = useAccessZones();
  const createCardholder = useCreateCardholder();
  const provisionCredential = useProvisionCredential();
  const revokeCredential = useRevokeCredential();
  const createZone = useCreateZone();

  const [form, setForm] = useState({
    personType: 'STAFF',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    title: '',
  });

  const [credForm, setCredForm] = useState({
    credentialType: 'PHYSICAL_CARD' as string,
    cardNumber: '',
    facilityCode: '',
    pinCode: '',
    cardFormat: '',
    zoneIds: [] as string[],
    expiresAt: '',
  });

  const [zoneForm, setZoneForm] = useState({ name: '', description: '' });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createCardholder.mutateAsync(form);
    setForm({ personType: 'STAFF', firstName: '', lastName: '', email: '', phone: '', company: '', title: '' });
    setShowCreate(false);
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showCredForm) return;
    await provisionCredential.mutateAsync({
      cardholderId: showCredForm,
      ...credForm,
      pinCode: credForm.pinCode || undefined,
      cardFormat: credForm.cardFormat || undefined,
      expiresAt: credForm.expiresAt || undefined,
    });
    setCredForm({ credentialType: 'PHYSICAL_CARD', cardNumber: '', facilityCode: '', pinCode: '', cardFormat: '', zoneIds: [], expiresAt: '' });
    setShowCredForm(null);
  };

  const handleRevoke = async (cardholderId: string, credentialId: string) => {
    if (!confirm('Revoke this credential?')) return;
    await revokeCredential.mutateAsync({ cardholderId, credentialId });
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneForm.name) return;
    await createZone.mutateAsync({ name: zoneForm.name, description: zoneForm.description || undefined });
    setZoneForm({ name: '', description: '' });
    setShowZoneForm(false);
  };

  const formatCredentialDisplay = (cred: any) => {
    const parts: string[] = [];
    if (cred.cardNumber) parts.push(`#${cred.cardNumber}`);
    if (cred.cardFormat) {
      const fmt = CARD_FORMATS.find((f) => f.value === cred.cardFormat);
      parts.push(fmt ? fmt.label : cred.cardFormat);
    }
    if (cred.pinCode) parts.push('PIN:****');
    return parts.join(' ');
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Access Control</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          {showCreate ? 'Cancel' : '+ Add Cardholder'}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="dark:bg-gray-800 bg-white rounded-lg p-4 space-y-3 dark:border-gray-700 border-gray-200 border">
          <h3 className="font-medium">New Cardholder</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select
              value={form.personType}
              onChange={(e) => setForm({ ...form, personType: e.target.value })}
              className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border"
            >
              {PERSON_TYPES.filter((t) => t !== 'ALL').map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input placeholder="First Name *" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input placeholder="Last Name *" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <button type="submit" disabled={createCardholder.isPending} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors disabled:opacity-50">
              {createCardholder.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {PERSON_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setActiveTab(type)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              activeTab === type
                ? 'bg-blue-600 text-white'
                : 'dark:bg-gray-800 bg-gray-200 dark:text-gray-400 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-300'
            }`}
          >
            {type === 'ALL' ? 'All' : type.charAt(0) + type.slice(1).toLowerCase()}
          </button>
        ))}
        <div className="flex-1" />
        <input
          placeholder="Search name, email, company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="dark:bg-gray-800 bg-gray-100 rounded-lg px-3 py-1.5 text-sm w-64 dark:border-gray-700 border-gray-300 border"
        />
      </div>

      {/* Cardholder Table */}
      <div className="dark:bg-gray-800 bg-white rounded-lg dark:border-gray-700 border-gray-200 border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="dark:bg-gray-750 bg-gray-50 dark:border-gray-700 border-gray-200 border-b">
              <th className="text-left px-4 py-3 font-medium dark:text-gray-400 text-gray-500">Name</th>
              <th className="text-left px-4 py-3 font-medium dark:text-gray-400 text-gray-500">Type</th>
              <th className="text-left px-4 py-3 font-medium dark:text-gray-400 text-gray-500">Company</th>
              <th className="text-left px-4 py-3 font-medium dark:text-gray-400 text-gray-500">Credentials</th>
              <th className="text-left px-4 py-3 font-medium dark:text-gray-400 text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium dark:text-gray-400 text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center dark:text-gray-500 text-gray-400">Loading...</td></tr>
            ) : !cardholders?.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center dark:text-gray-500 text-gray-400">No cardholders found</td></tr>
            ) : (
              (cardholders as any[]).map((ch: any) => (
                <tr key={ch.id} className="dark:border-gray-700 border-gray-200 border-b dark:hover:bg-gray-750 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{ch.firstName} {ch.lastName}</div>
                    {ch.email && <div className="text-xs dark:text-gray-500 text-gray-400">{ch.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[ch.personType] || ''}`}>
                      {ch.personType}
                    </span>
                  </td>
                  <td className="px-4 py-3 dark:text-gray-400 text-gray-600">{ch.company || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {ch.credentials?.length ? (
                        ch.credentials.map((cred: any) => (
                          <div key={cred.id} className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[cred.status] || ''}`}>
                              {cred.credentialType.replace('_', ' ')}
                            </span>
                            <span className="text-xs dark:text-gray-500 text-gray-400">
                              {formatCredentialDisplay(cred)}
                            </span>
                            {cred.status === 'ACTIVE' && (
                              <button
                                onClick={() => handleRevoke(ch.id, cred.id)}
                                className="text-xs text-red-400 hover:text-red-300"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="text-xs dark:text-gray-600 text-gray-400">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${ch.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {ch.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setShowCredForm(showCredForm === ch.id ? null : ch.id)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      + Credential
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Credential Provisioning Form (inline below table) */}
      {showCredForm && (
        <form onSubmit={handleProvision} className="dark:bg-gray-800 bg-white rounded-lg p-4 space-y-3 dark:border-gray-700 border-gray-200 border">
          <h3 className="font-medium">Provision Credential</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select
              value={credForm.credentialType}
              onChange={(e) => setCredForm({ ...credForm, credentialType: e.target.value })}
              className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border"
            >
              {CREDENTIAL_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              value={credForm.cardFormat}
              onChange={(e) => setCredForm({ ...credForm, cardFormat: e.target.value })}
              className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border"
            >
              <option value="">Card Format (optional)</option>
              {CARD_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}{f.bits ? ` (${f.bits}-bit)` : ''}
                </option>
              ))}
            </select>
            <input placeholder="Card Number" value={credForm.cardNumber} onChange={(e) => setCredForm({ ...credForm, cardNumber: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input placeholder="Facility Code" value={credForm.facilityCode} onChange={(e) => setCredForm({ ...credForm, facilityCode: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" />
            <input
              placeholder="PIN Code (optional)"
              value={credForm.pinCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                setCredForm({ ...credForm, pinCode: val });
              }}
              inputMode="numeric"
              maxLength={8}
              className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border"
            />
            <input type="datetime-local" value={credForm.expiresAt} onChange={(e) => setCredForm({ ...credForm, expiresAt: e.target.value })} className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-2 text-sm dark:border-gray-600 border-gray-300 border" placeholder="Expires (optional)" />
          </div>
          {zones && (zones as any[]).length > 0 && (
            <div>
              <label className="block text-xs dark:text-gray-400 text-gray-500 mb-1">Access Zones</label>
              <div className="flex flex-wrap gap-2">
                {(zones as any[]).map((z: any) => (
                  <label key={z.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={credForm.zoneIds.includes(z.id)}
                      onChange={(e) => {
                        setCredForm({
                          ...credForm,
                          zoneIds: e.target.checked
                            ? [...credForm.zoneIds, z.id]
                            : credForm.zoneIds.filter((id) => id !== z.id),
                        });
                      }}
                    />
                    {z.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={provisionCredential.isPending} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">
              {provisionCredential.isPending ? 'Provisioning...' : 'Provision'}
            </button>
            <button type="button" onClick={() => setShowCredForm(null)} className="px-4 py-2 dark:bg-gray-700 bg-gray-200 rounded text-sm dark:hover:bg-gray-600 hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Access Zones Section */}
      <div className="dark:bg-gray-800 bg-white rounded-lg dark:border-gray-700 border-gray-200 border overflow-hidden">
        <button
          onClick={() => setShowZones(!showZones)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
        >
          <h3 className="font-medium">Access Zones</h3>
          <span className="text-xs dark:text-gray-500 text-gray-400">
            {(zones as any[])?.length || 0} zone{(zones as any[])?.length !== 1 ? 's' : ''} {showZones ? '▲' : '▼'}
          </span>
        </button>
        {showZones && (
          <div className="border-t dark:border-gray-700 border-gray-200">
            {zones && (zones as any[]).length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="dark:bg-gray-750 bg-gray-50 dark:border-gray-700 border-gray-200 border-b">
                    <th className="text-left px-4 py-2 font-medium dark:text-gray-400 text-gray-500">Zone Name</th>
                    <th className="text-left px-4 py-2 font-medium dark:text-gray-400 text-gray-500">Description</th>
                    <th className="text-left px-4 py-2 font-medium dark:text-gray-400 text-gray-500">Doors</th>
                    <th className="text-left px-4 py-2 font-medium dark:text-gray-400 text-gray-500">Credentials</th>
                  </tr>
                </thead>
                <tbody>
                  {(zones as any[]).map((z: any) => (
                    <tr key={z.id} className="dark:border-gray-700 border-gray-200 border-b">
                      <td className="px-4 py-2 font-medium">{z.name}</td>
                      <td className="px-4 py-2 dark:text-gray-400 text-gray-600">{z.description || '-'}</td>
                      <td className="px-4 py-2 dark:text-gray-400 text-gray-600">{z._count?.doorAssignments ?? z.doorAssignments?.length ?? 0}</td>
                      <td className="px-4 py-2 dark:text-gray-400 text-gray-600">{z._count?.credentials ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-4 text-sm dark:text-gray-500 text-gray-400">No access zones defined yet.</p>
            )}
            <div className="px-4 py-3 flex gap-2 border-t dark:border-gray-700 border-gray-200">
              {showZoneForm ? (
                <form onSubmit={handleCreateZone} className="flex gap-2 items-center w-full">
                  <input
                    placeholder="Zone name *"
                    required
                    value={zoneForm.name}
                    onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                    className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-1.5 text-sm dark:border-gray-600 border-gray-300 border flex-1"
                  />
                  <input
                    placeholder="Description"
                    value={zoneForm.description}
                    onChange={(e) => setZoneForm({ ...zoneForm, description: e.target.value })}
                    className="dark:bg-gray-700 bg-gray-100 rounded px-3 py-1.5 text-sm dark:border-gray-600 border-gray-300 border flex-1"
                  />
                  <button type="submit" disabled={createZone.isPending} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">
                    {createZone.isPending ? 'Creating...' : 'Create'}
                  </button>
                  <button type="button" onClick={() => setShowZoneForm(false)} className="px-3 py-1.5 dark:bg-gray-700 bg-gray-200 rounded text-sm">
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <button
                    onClick={() => setShowZoneForm(true)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    + Create Zone
                  </button>
                  <button
                    disabled
                    title="Requires a connected PAC system (e.g., Sicunet)"
                    className="px-3 py-1.5 dark:bg-gray-700 bg-gray-200 rounded text-sm opacity-50 cursor-not-allowed"
                  >
                    Sync from PAC
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

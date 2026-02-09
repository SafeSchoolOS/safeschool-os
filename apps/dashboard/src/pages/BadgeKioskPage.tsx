import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || '';

export function BadgeKioskPage() {
  const { token } = useAuth();
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<any[]>([]);
  const [license, setLicense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/api/v1/sites`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setSites(data);
        if (data.length > 0) setSiteId(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!siteId) return;
    fetch(`${API_URL}/api/v1/licenses/${siteId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setLicense)
      .catch(() => setLicense(null));
  }, [siteId, token]);

  const saveLicense = async (updates: any) => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/v1/licenses/${siteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setLicense(data);
        setMessage('License updated successfully');
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage(err.error || 'Failed to update license');
      }
    } catch {
      setMessage('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">

        {/* Site Selector */}
        {sites.length > 1 && (
          <select value={siteId} onChange={e => setSiteId(e.target.value)}
            className="mb-6 p-3 bg-gray-800 rounded-lg border border-gray-700 text-white">
            {sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {message && (
          <div className={`mb-6 p-3 rounded-lg text-sm ${message.includes('success') ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            {message}
          </div>
        )}

        {/* Current License */}
        <div className="bg-gray-800 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Current License</h2>
          <div className="flex items-center gap-4 mb-4">
            <span className={`px-4 py-2 rounded-full text-sm font-bold ${
              license?.tier === 'enterprise' ? 'bg-purple-600' :
              license?.tier === 'professional' ? 'bg-blue-600' :
              'bg-gray-600'
            }`}>
              {(license?.tier || 'free').toUpperCase()}
            </span>
            {license?.expiresAt && (
              <span className="text-sm text-gray-400">
                Expires: {new Date(license.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-400">Max Kiosks: {license?.maxKiosks || 1}</div>
        </div>

        {/* Feature Tiers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Free Tier */}
          <div className="bg-gray-800 rounded-xl p-6 border-2 border-gray-700">
            <h3 className="text-lg font-bold mb-1">Free</h3>
            <p className="text-2xl font-bold text-green-400 mb-4">$0</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> Visitor Check-In/Out</li>
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> ID Screening (NSOPW)</li>
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> Visitor Logs</li>
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> Browser Badge Print</li>
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> 1 Kiosk</li>
              <li className="flex items-center gap-2 text-gray-500"><span>&#10007;</span> Professional Printing</li>
              <li className="flex items-center gap-2 text-gray-500"><span>&#10007;</span> Guard Console</li>
            </ul>
            {license?.tier === 'free' && (
              <div className="mt-4 text-center text-sm text-green-400 font-medium">Current Plan</div>
            )}
          </div>

          {/* Professional Tier */}
          <div className="bg-gray-800 rounded-xl p-6 border-2 border-blue-600">
            <h3 className="text-lg font-bold mb-1">Professional</h3>
            <p className="text-2xl font-bold text-blue-400 mb-4">Contact Sales</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> Everything in Free</li>
              <li className="flex items-center gap-2"><span className="text-blue-400">&#10003;</span> Professional Badge Printing</li>
              <li className="flex items-center gap-2"><span className="text-blue-400">&#10003;</span> Thermal/Label Printers</li>
              <li className="flex items-center gap-2"><span className="text-blue-400">&#10003;</span> Badge Templates</li>
              <li className="flex items-center gap-2"><span className="text-blue-400">&#10003;</span> QR Code Badges</li>
              <li className="flex items-center gap-2"><span className="text-blue-400">&#10003;</span> Up to 5 Kiosks</li>
              <li className="flex items-center gap-2 text-gray-500"><span>&#10007;</span> Guard Console</li>
            </ul>
            {license?.tier === 'professional' && license?.badgePrinting && (
              <div className="mt-4 text-center text-sm text-blue-400 font-medium">Current Plan</div>
            )}
          </div>

          {/* Enterprise Tier */}
          <div className="bg-gray-800 rounded-xl p-6 border-2 border-purple-600">
            <h3 className="text-lg font-bold mb-1">Enterprise</h3>
            <p className="text-2xl font-bold text-purple-400 mb-4">Contact Sales</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><span className="text-green-400">&#10003;</span> Everything in Professional</li>
              <li className="flex items-center gap-2"><span className="text-purple-400">&#10003;</span> Guard Console</li>
              <li className="flex items-center gap-2"><span className="text-purple-400">&#10003;</span> Manual Check-In/Out</li>
              <li className="flex items-center gap-2"><span className="text-purple-400">&#10003;</span> Real-Time Monitoring</li>
              <li className="flex items-center gap-2"><span className="text-purple-400">&#10003;</span> Guard Alerts</li>
              <li className="flex items-center gap-2"><span className="text-purple-400">&#10003;</span> Activity Log</li>
              <li className="flex items-center gap-2"><span className="text-purple-400">&#10003;</span> Unlimited Kiosks</li>
            </ul>
            {license?.tier === 'enterprise' && (
              <div className="mt-4 text-center text-sm text-purple-400 font-medium">Current Plan</div>
            )}
          </div>
        </div>

        {/* Admin Controls (SUPER_ADMIN only) */}
        <div className="bg-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">License Administration</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={license?.badgePrinting || false}
                onChange={e => saveLicense({ badgePrinting: e.target.checked, guardConsole: license?.guardConsole })}
                className="w-5 h-5 rounded" disabled={saving} />
              <span>Badge Printing</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={license?.guardConsole || false}
                onChange={e => saveLicense({ guardConsole: e.target.checked, badgePrinting: license?.badgePrinting })}
                className="w-5 h-5 rounded" disabled={saving} />
              <span>Guard Console</span>
            </label>
          </div>
          <p className="text-xs text-gray-500">Only SUPER_ADMIN users can toggle these features.</p>
        </div>
      </div>
    </div>
  );
}


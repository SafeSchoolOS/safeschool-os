import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';
import { kioskApi } from '../api/client';

export function BadgePage() {
  useKioskMode(30000);
  const { id } = useParams();
  const navigate = useNavigate();
  const [visitor, setVisitor] = useState<any>(null);
  const [features, setFeatures] = useState<any>(null);
  const [printing, setPrinting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);

  useEffect(() => {
    if (id) {
      kioskApi.get(`/visitors/${id}`).then(setVisitor).catch(() => navigate('/'));
    }
    // Check licensed features
    const siteId = import.meta.env.VITE_SITE_ID;
    if (siteId) {
      kioskApi.get(`/licenses/${siteId}/features`).then(setFeatures).catch(() => {});
    }
  }, [id, navigate]);

  const handlePrint = async () => {
    if (!features?.badgePrinting) {
      // Free tier: browser print only
      window.print();
      return;
    }

    // Licensed badge printing: generate and print via API
    setPrinting(true);
    try {
      const badge = await kioskApi.post(`/badges/${id}/generate`, { format: 'html' });
      // Open badge HTML in print window
      const printWindow = window.open('', '_blank', 'width=300,height=500');
      if (printWindow) {
        printWindow.document.write(badge.html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      }
      // Log print job
      await kioskApi.post(`/badges/${id}/print-job`, { copies: 1 }).catch(() => {});
      setPrintSuccess(true);
    } catch {
      // Fallback to browser print
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  if (!visitor) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white p-8">
      <div className="bg-white text-gray-900 rounded-3xl p-12 max-w-md w-full text-center shadow-2xl print:shadow-none print:rounded-none">
        <div className="text-green-600 text-6xl mb-4">&#10003;</div>
        <h2 className="text-3xl font-bold mb-2">Welcome!</h2>
        <p className="text-xl mb-6">{visitor.firstName} {visitor.lastName}</p>

        <div className="bg-gray-100 rounded-xl p-6 mb-6 text-left">
          <div className="mb-2"><span className="text-gray-500">Badge #:</span> <span className="font-bold text-2xl">{visitor.badgeNumber}</span></div>
          <div className="mb-2"><span className="text-gray-500">Purpose:</span> {visitor.purpose}</div>
          <div className="mb-2"><span className="text-gray-500">Destination:</span> {visitor.destination}</div>
          <div><span className="text-gray-500">Time:</span> {new Date(visitor.checkedInAt).toLocaleTimeString()}</div>
        </div>

        <p className="text-sm text-gray-500 mb-4">Please wear your badge visibly at all times</p>

        <button
          onClick={handlePrint}
          disabled={printing}
          className="w-full p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-colors mb-3 disabled:bg-gray-400 print:hidden"
        >
          {printing ? 'Printing...' : printSuccess ? 'Print Another' : 'Print Badge'}
        </button>

        {features?.badgePrinting && (
          <p className="text-xs text-green-600 print:hidden">Professional badge printing enabled</p>
        )}
      </div>

      <button onClick={() => navigate('/')} className="mt-8 text-gray-400 hover:text-white text-lg print:hidden">
        Done
      </button>
    </div>
  );
}

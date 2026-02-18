import { useState } from 'react';
import { useSendNotification } from '../../api/notifications';

export function SendNotificationForm() {
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState<'all-staff' | 'all-parents' | 'specific-users'>('all-staff');
  const [channels, setChannels] = useState<string[]>(['SMS', 'EMAIL']);
  const [sent, setSent] = useState(false);
  const send = useSendNotification();

  const toggleChannel = (ch: string) => {
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message || channels.length === 0) return;

    await send.mutateAsync({ channels, message, recipientScope: scope });
    setSent(true);
    setMessage('');
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4">Send Notification</h3>

      <form onSubmit={handleSend} className="space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Notification message..."
          className="w-full p-2 bg-gray-700 rounded border border-gray-600 text-white placeholder-gray-500 h-20 resize-none"
          required
        />

        <div>
          <label className="text-sm text-gray-400 block mb-1">Recipients</label>
          <select
            value={scope}
            onChange={e => setScope(e.target.value as any)}
            className="w-full p-2 bg-gray-700 rounded border border-gray-600 text-white"
          >
            <option value="all-staff">All Staff</option>
            <option value="all-parents">All Parents</option>
          </select>
        </div>

        <div>
          <label className="text-sm text-gray-400 block mb-1">Channels</label>
          <div className="flex gap-2">
            {['SMS', 'EMAIL', 'PUSH', 'PA'].map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  channels.includes(ch)
                    ? 'bg-blue-700 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={send.isPending || !message || channels.length === 0}
          className="w-full p-2 bg-orange-700 hover:bg-orange-600 disabled:bg-gray-600 rounded transition-colors font-medium"
        >
          {send.isPending ? 'Sending...' : 'Send Notification'}
        </button>
      </form>

      {sent && <div className="mt-3 p-2 bg-green-900 text-green-200 rounded text-sm">Notification sent!</div>}
    </div>
  );
}

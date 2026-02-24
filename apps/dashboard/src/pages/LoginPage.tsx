import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'dev';

function ClerkSignIn() {
  // Dynamically render Clerk's SignIn component
  const [SignIn, setSignIn] = useState<any>(null);

  if (!SignIn) {
    import('@clerk/clerk-react').then((mod) => {
      setSignIn(() => mod.SignIn);
    });
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading authentication...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">SafeSchool OS</h1>
          <p className="text-gray-400 mt-2">Command Center Login</p>
        </div>
        <div className="flex justify-center">
          <SignIn />
        </div>
      </div>
    </div>
  );
}

const DEMO_ACCOUNTS: Record<string, string> = {
  admin: 'admin@lincoln.edu',
  operator: 'operator@lincoln.edu',
  teacher: 'teacher1@lincoln.edu',
  responder: 'responder@lincoln.edu',
};

function DevLoginForm() {
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoLogging, setAutoLogging] = useState(false);
  const [showRequestAccess, setShowRequestAccess] = useState(false);
  const [requestForm, setRequestForm] = useState({ name: '', email: '', school: '', role: 'Administrator', phone: '', buildings: 1, state: '', message: '' });
  const [requestStatus, setRequestStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [requestError, setRequestError] = useState('');
  const attempted = useRef(false);

  // Auto-login via ?demo=admin (or operator, teacher, responder)
  const demo = searchParams.get('demo');
  useEffect(() => {
    if (demo && !attempted.current) {
      attempted.current = true;
      const demoEmail = DEMO_ACCOUNTS[demo] || DEMO_ACCOUNTS['admin'];
      setAutoLogging(true);
      login(demoEmail, 'safeschool123').catch((err: any) => {
        setAutoLogging(false);
        setError(err.message || 'Auto-login failed');
      });
    }
  }, [demo, login]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (preset: string) => {
    setError('');
    setLoading(true);
    try {
      await login(preset, 'safeschool123');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  if (autoLogging) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-white text-lg">Signing into demo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">SafeSchool OS</h1>
          <p className="text-gray-400 mt-2">Command Center Login</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@lincoln.edu"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 pr-12 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button type="button" onClick={() => setShowRequestAccess(true)} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            New school? Request Access
          </button>
        </div>

        {!import.meta.env.VITE_API_URL && (
        <div className="mt-6 border-t border-gray-700 pt-6">
          <p className="text-gray-500 text-xs mb-3 text-center">Quick login (dev only)</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => quickLogin('admin@lincoln.edu')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
              Admin
            </button>
            <button onClick={() => quickLogin('operator@lincoln.edu')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
              Operator
            </button>
            <button onClick={() => quickLogin('teacher1@lincoln.edu')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
              Teacher 1
            </button>
            <button onClick={() => quickLogin('responder@lincoln.edu')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
              Responder
            </button>
          </div>
        </div>
        )}
      </div>

      {showRequestAccess && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {requestStatus === 'success' ? (
              <div className="text-center py-8">
                <div className="text-green-400 text-4xl mb-4">&#10003;</div>
                <h2 className="text-xl font-bold text-white mb-2">Request Submitted!</h2>
                <p className="text-gray-400 mb-6">We'll review your request and reach out within 24 hours.</p>
                <button onClick={() => { setShowRequestAccess(false); setRequestStatus('idle'); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Close</button>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-white mb-4">Request School Access</h2>
                <p className="text-gray-400 text-sm mb-4">Fill out this form and our team will set up your school's account.</p>
                <div className="space-y-3">
                  <input value={requestForm.school} onChange={(e) => setRequestForm({ ...requestForm, school: e.target.value })} placeholder="School / District name *" className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" required />
                  <div className="grid grid-cols-2 gap-3">
                    <input value={requestForm.name} onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })} placeholder="Your name *" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" required />
                    <input value={requestForm.email} onChange={(e) => setRequestForm({ ...requestForm, email: e.target.value })} placeholder="Email *" type="email" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input value={requestForm.phone} onChange={(e) => setRequestForm({ ...requestForm, phone: e.target.value })} placeholder="Phone" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
                    <input value={requestForm.state} onChange={(e) => setRequestForm({ ...requestForm, state: e.target.value })} placeholder="State *" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <select value={requestForm.role} onChange={(e) => setRequestForm({ ...requestForm, role: e.target.value })} className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white">
                      <option>Administrator</option><option>IT Director</option><option>Principal</option><option>Safety Officer</option><option>Superintendent</option><option>Other</option>
                    </select>
                    <input type="number" min={1} value={requestForm.buildings} onChange={(e) => setRequestForm({ ...requestForm, buildings: parseInt(e.target.value) || 1 })} placeholder="# Buildings" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
                  </div>
                  <textarea value={requestForm.message} onChange={(e) => setRequestForm({ ...requestForm, message: e.target.value })} placeholder="Additional notes (optional)" rows={2} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400" />
                </div>
                {requestError && <div className="mt-3 text-red-400 text-sm">{requestError}</div>}
                <div className="flex justify-end gap-3 mt-4">
                  <button onClick={() => setShowRequestAccess(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                  <button
                    disabled={requestStatus === 'submitting' || !requestForm.name || !requestForm.email || !requestForm.school || !requestForm.state}
                    onClick={async () => {
                      setRequestStatus('submitting');
                      setRequestError('');
                      try {
                        const API_BASE = import.meta.env.VITE_API_URL || '';
                        const res = await fetch(API_BASE + '/api/v1/demo-requests', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(requestForm),
                        });
                        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed to submit'); }
                        setRequestStatus('success');
                      } catch (err: any) { setRequestError(err.message); setRequestStatus('idle'); }
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
                  >
                    {requestStatus === 'submitting' ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LoginPage() {
  if (authProvider === 'clerk') {
    return <ClerkSignIn />;
  }
  return <DevLoginForm />;
}

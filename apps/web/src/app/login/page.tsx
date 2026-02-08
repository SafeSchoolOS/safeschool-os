'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Shield, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userName, setUserName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Login failed (${res.status})`);
      }

      const data = await res.json();
      if (typeof window !== 'undefined') {
        localStorage.setItem('safeschool_token', data.token);
      }
      setUserName(data.user?.name || email);
      setAuthenticated(true);
    } catch (err: any) {
      setError(err.message || 'Unable to connect to server');
    } finally {
      setLoading(false);
    }
  };

  if (authenticated) {
    return (
      <section className="min-h-[calc(100vh-72px)] flex items-center justify-center px-6 bg-gradient-to-b from-slate-50 to-white">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-teal-600" />
          </div>
          <h1 className="text-2xl font-bold text-navy-700 mb-2">Welcome, {userName}</h1>
          <p className="text-slate-600 mb-8">You are now authenticated.</p>
          <div className="space-y-3">
            <a
              href="https://dashboard-production-ed96.up.railway.app"
              className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </a>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  localStorage.removeItem('safeschool_token');
                }
                setAuthenticated(false);
                setEmail('');
              }}
              className="w-full px-6 py-3 text-slate-600 font-medium hover:text-navy-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-72px)] flex items-center justify-center px-6 bg-gradient-to-b from-slate-50 to-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-navy-700 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-teal-400" />
          </div>
          <h1 className="text-2xl font-bold text-navy-700">Sign in to SafeSchool</h1>
          <p className="text-slate-500 mt-2">Access your school safety command center</p>
        </div>

        <div className="bg-white rounded-card border border-slate-200 shadow-card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourschool.edu"
                autoComplete="email"
                required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-button text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-button text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full py-3 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white font-semibold rounded-button transition-colors"
            >
              {loading ? (
                'Signing in...'
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/contact" className="text-teal-600 hover:text-teal-700 font-medium">
            Contact us
          </Link>
        </p>
      </div>
    </section>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { Lock } from 'lucide-react';

export const metadata: Metadata = {
  title: `School Dashboard | ${SITE_NAME}`,
};

export default function DashboardPage() {
  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-narrow text-center">
        <ScrollReveal>
          <Lock className="w-16 h-16 text-slate-300 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-navy-700 mb-4">School Dashboard</h1>
          <p className="text-lg text-slate-600 mb-2">Coming Q2 2026</p>
          <p className="text-slate-500 max-w-md mx-auto mb-8">
            The school dashboard will provide real-time device monitoring, emergency controls,
            visitor management, and compliance reporting.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center px-6 py-2.5 bg-teal-500 text-white text-sm font-semibold rounded-button hover:bg-teal-600 transition-colors"
          >
            Sign Up to Be Notified
          </Link>
        </ScrollReveal>
      </div>
    </section>
  );
}

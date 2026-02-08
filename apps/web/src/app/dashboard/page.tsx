import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { ExternalLink } from 'lucide-react';

// Force dynamic rendering so DASHBOARD_URL is read at request time
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `School Dashboard | ${SITE_NAME}`,
};

export default function DashboardPage() {
  const dashboardUrl = process.env.DASHBOARD_URL;

  if (dashboardUrl) {
    redirect(dashboardUrl);
  }

  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-narrow text-center">
        <ScrollReveal>
          <ExternalLink className="w-16 h-16 text-slate-300 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-navy-700 mb-4">School Dashboard</h1>
          <p className="text-slate-500 max-w-md mx-auto mb-8">
            The dashboard is deployed as a separate service. Contact your administrator
            for access, or use the direct link provided during onboarding.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center px-6 py-2.5 bg-teal-500 text-white text-sm font-semibold rounded-button hover:bg-teal-600 transition-colors"
          >
            Contact Us
          </Link>
        </ScrollReveal>
      </div>
    </section>
  );
}

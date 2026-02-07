import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { MembershipApplicationForm } from '@/components/forms/MembershipApplicationForm';
import { PricingSection } from '@/components/sections/PricingTier';
import { ScrollReveal } from '@/components/common/ScrollReveal';

export const metadata: Metadata = generatePageMetadata('membership');

export default function MembershipPage() {
  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-4">
            Manufacturer Membership
          </p>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Apply for Founding Membership
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[600px] mx-auto">
            Join the SafeSchool ecosystem as a founding member. Get your hardware certified and into every school.
          </p>
        </div>
      </section>

      <PricingSection />

      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-[700px]">
          <ScrollReveal>
            <h2 className="text-2xl font-bold text-navy-700 text-center mb-8">
              Membership Application
            </h2>
            <div className="bg-white border border-slate-200 rounded-card p-8 shadow-card">
              <MembershipApplicationForm />
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

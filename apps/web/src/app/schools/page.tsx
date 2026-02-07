import type { Metadata } from 'next';
import Link from 'next/link';
import { generatePageMetadata } from '@/lib/metadata';
import { FeatureGrid } from '@/components/sections/FeatureGrid';
import { CTABanner } from '@/components/sections/CTABanner';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { schoolFeatures } from '@/content/data/features';

export const metadata: Metadata = generatePageMetadata('schools');

export default function SchoolsPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 md:py-32 px-6 text-center">
        <div className="mx-auto max-w-content">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-4">
            For Schools & Districts
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-[1.1] tracking-[-0.02em] text-balance">
            Your School Deserves the Best Safety Technology.{' '}
            <span className="text-teal-400">For Free.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-[640px] mx-auto">
            Get the complete SafeSchool platform at zero cost. Access control, panic alerts, visitor management, and full Alyssa&apos;s Law compliance.
          </p>
          <div className="mt-10">
            <Link
              href="/contact"
              className="inline-flex items-center px-8 py-3.5 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors"
            >
              Sign Up for SafeSchool — It&apos;s Free
            </Link>
          </div>
        </div>
      </section>

      {/* What You Get */}
      <FeatureGrid
        overline="Everything Included"
        title="What You Get"
        features={schoolFeatures}
        columns={2}
      />

      {/* How It's Free */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="How Is This Free?" />
            <p className="text-center text-lg text-slate-700 leading-relaxed">
              Manufacturer memberships fund the platform. Every school that uses SafeSchool sees our
              founding members&apos; logos and products. That visibility is why they sponsor the platform.
              You get enterprise-grade safety technology. They get market access. Everyone wins.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Directory CTAs */}
      <section className="py-section px-6">
        <div className="mx-auto max-w-content grid md:grid-cols-2 gap-6">
          <ScrollReveal>
            <div className="border border-slate-200 rounded-card p-8 hover:shadow-card-hover transition-all">
              <h3 className="text-xl font-bold text-navy-700 mb-3">Certified Hardware Directory</h3>
              <p className="text-slate-600 mb-6">
                Choose from hardware certified to work perfectly with SafeSchool. Readers, panels, panic buttons, cameras, and more.
              </p>
              <Link href="/directory/hardware" className="text-sm font-semibold text-teal-600 hover:text-teal-700">
                Browse Hardware &rarr;
              </Link>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <div className="border border-slate-200 rounded-card p-8 hover:shadow-card-hover transition-all">
              <h3 className="text-xl font-bold text-navy-700 mb-3">Certified Installer Directory</h3>
              <p className="text-slate-600 mb-6">
                Find a trained installer in your area. They handle everything — installation, configuration, and testing.
              </p>
              <Link href="/directory/installers" className="text-sm font-semibold text-teal-600 hover:text-teal-700">
                Find an Installer &rarr;
              </Link>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Support tiers */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-content">
          <ScrollReveal>
            <SectionHeading title="Support Options" />
          </ScrollReveal>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              { name: 'Community', price: 'Free', features: ['Forums', 'Documentation', 'GitHub'] },
              { name: 'Standard', price: 'Contact Us', features: ['Email support', '24-hour SLA', 'Onboarding assistance'] },
              { name: 'Priority', price: 'Contact Us', features: ['Phone support', '4-hour SLA', 'Dedicated account manager'] },
            ].map((tier, i) => (
              <ScrollReveal key={tier.name} delay={i * 0.1}>
                <div className="bg-white border border-slate-200 rounded-card p-6 text-center">
                  <h4 className="font-bold text-navy-700">{tier.name}</h4>
                  <p className="text-sm text-teal-600 font-semibold mt-1">{tier.price}</p>
                  <ul className="mt-4 space-y-2 text-sm text-slate-600">
                    {tier.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <CTABanner
        headline="Ready to protect your school?"
        primaryCTA={{ label: "Sign Up — It's Free", href: '/contact' }}
        secondaryCTA={{ label: 'View Hardware Directory', href: '/directory/hardware' }}
      />
    </>
  );
}

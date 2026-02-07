import type { Metadata } from 'next';
import Link from 'next/link';
import { generatePageMetadata } from '@/lib/metadata';
import { PricingSection } from '@/components/sections/PricingTier';
import { CTABanner } from '@/components/sections/CTABanner';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { CertifiedBadge } from '@/components/common/CertifiedBadge';
import { foundingMembers } from '@/content/data/founding-members';

export const metadata: Metadata = generatePageMetadata('manufacturers');

const certSteps = [
  { num: 1, title: 'Submit Hardware', desc: 'Complete the membership application with your product details.' },
  { num: 2, title: 'Integration Testing', desc: 'Our team tests your hardware against SafeSchool APIs.' },
  { num: 3, title: 'Functional Testing', desc: 'Automated QA scenarios validate real-world operations.' },
  { num: 4, title: 'Security Review', desc: 'Firmware and communication security audit.' },
  { num: 5, title: 'Certification Report', desc: 'Detailed report of test results and compatibility.' },
  { num: 6, title: 'Directory Listing', desc: 'Your product is live in the certified hardware directory.' },
  { num: 7, title: 'Annual Recertification', desc: 'Yearly revalidation ensures continued compatibility.' },
];

export default function ManufacturersPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 md:py-32 px-6 text-center">
        <div className="mx-auto max-w-content">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-4">
            For Hardware Manufacturers
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-[1.1] tracking-[-0.02em] text-balance">
            Get Your Hardware Into Every School in America.
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-[640px] mx-auto">
            Schools adopting SafeSchool choose from the certified hardware directory. Your hardware listed = your hardware sold. No software to build. No platform to maintain.
          </p>
          <div className="mt-10">
            <Link
              href="/membership"
              className="inline-flex items-center px-8 py-3.5 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors"
            >
              Apply for Founding Membership
            </Link>
          </div>
        </div>
      </section>

      {/* The Opportunity */}
      <section className="py-section px-6">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="The Opportunity" />
            <p className="text-center text-lg text-slate-700 leading-relaxed">
              Schools using SafeSchool need hardware. They browse the certified directory and choose products
              that have passed our rigorous testing. No software to build. No platform to maintain. Just make
              great hardware and get certified.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Current Members */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-content">
          <ScrollReveal>
            <SectionHeading title="Join These Companies" />
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <div className="flex flex-wrap items-center justify-center gap-8">
              {foundingMembers.map((member) => (
                <div key={member.slug} className="flex items-center gap-3">
                  <span className="text-xl font-bold text-navy-700">{member.name}</span>
                  <CertifiedBadge variant="charter" />
                </div>
              ))}
              <div className="text-slate-400 italic text-sm">Your company here...</div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* Certification Process */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="Certification Process" />
          </ScrollReveal>
          <div className="relative">
            <div className="absolute left-6 top-8 bottom-8 w-px bg-slate-200" />
            <div className="space-y-8">
              {certSteps.map((step, i) => (
                <ScrollReveal key={step.num} delay={i * 0.05}>
                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-navy-700 text-white flex items-center justify-center font-bold text-sm relative z-10">
                      {step.num}
                    </div>
                    <div className="pt-2">
                      <h4 className="font-bold text-navy-700">{step.title}</h4>
                      <p className="text-sm text-slate-600 mt-1">{step.desc}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CTABanner
        headline="Ready to join the ecosystem?"
        primaryCTA={{ label: 'Apply for Founding Membership', href: '/membership' }}
        secondaryCTA={{ label: 'Contact Us', href: '/contact' }}
      />
    </>
  );
}

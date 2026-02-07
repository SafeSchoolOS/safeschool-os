import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { CTABanner } from '@/components/sections/CTABanner';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { alyssaLawStates } from '@/content/data/compliance-states';
import { CheckCircle, Clock } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata('alyssa-law');

export default function AlyssaLawPage() {
  const enacted = alyssaLawStates.filter((s) => s.status === 'enacted');
  const pending = alyssaLawStates.filter((s) => s.status === 'pending');

  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em] text-balance">
            Alyssa&apos;s Law Compliance
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[640px] mx-auto">
            Named after Alyssa Alhadeff, a victim of the 2018 Parkland shooting. These laws require
            silent panic alarms in schools connected directly to 911.
          </p>
        </div>
      </section>

      <section className="py-section px-6">
        <div className="mx-auto max-w-content">
          <ScrollReveal>
            <SectionHeading
              title="SafeSchool Meets Every Requirement"
              subtitle="Our platform is built from the ground up for Alyssa's Law compliance. Silent panic, location data, direct 911 dispatch — all included."
            />
          </ScrollReveal>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {enacted.map((state, i) => (
              <ScrollReveal key={state.code} delay={i * 0.05}>
                <div className="bg-white border border-slate-200 rounded-card p-6 hover:shadow-card-hover transition-all">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-teal-500" />
                    <h3 className="font-bold text-navy-700">{state.name}</h3>
                    <span className="text-xs bg-teal-50 text-teal-700 font-medium px-2 py-0.5 rounded-badge">
                      Enacted {state.year}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{state.details}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>

          {pending.length > 0 && (
            <>
              <ScrollReveal>
                <SectionHeading title="Pending Legislation" />
              </ScrollReveal>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pending.map((state, i) => (
                  <ScrollReveal key={state.code} delay={i * 0.05}>
                    <div className="bg-white border border-slate-200 rounded-card p-6">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="w-5 h-5 text-gold-500" />
                        <h3 className="font-bold text-navy-700">{state.name}</h3>
                        <span className="text-xs bg-gold-50 text-gold-700 font-medium px-2 py-0.5 rounded-badge">
                          Pending
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{state.details}</p>
                    </div>
                  </ScrollReveal>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Key requirements */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="Key Requirements Met by SafeSchool" />
            <div className="space-y-4">
              {[
                { req: 'Silent panic alarm system', desc: 'Discreet wearable and mobile panic buttons that alert without visible or audible indication.' },
                { req: 'Direct 911/PSAP integration', desc: 'NENA i3 compliant dispatch with automatic location data transmission.' },
                { req: 'Real-time location data', desc: 'BLE mesh and GPS indoor/outdoor positioning for first responders.' },
                { req: 'Automated lockdown capability', desc: 'Instant building-wide or zone-specific lockdown on alert activation.' },
                { req: 'Notification to law enforcement', desc: 'Dual-path dispatch: direct 911 + RapidSOS with cellular failover.' },
              ].map((item, i) => (
                <ScrollReveal key={item.req} delay={i * 0.05}>
                  <div className="bg-white border border-slate-200 rounded-card p-6">
                    <h4 className="font-bold text-navy-700 mb-1">{item.req}</h4>
                    <p className="text-sm text-slate-600">{item.desc}</p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      <CTABanner
        headline="Ensure your school is compliant"
        primaryCTA={{ label: "Get Started — It's Free", href: '/schools' }}
        secondaryCTA={{ label: 'Contact Us', href: '/contact' }}
      />
    </>
  );
}

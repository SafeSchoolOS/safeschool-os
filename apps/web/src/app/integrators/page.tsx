import type { Metadata } from 'next';
import Link from 'next/link';
import { generatePageMetadata } from '@/lib/metadata';
import { CTABanner } from '@/components/sections/CTABanner';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { Check } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata('integrators');

const benefits = [
  'Listed in the certified installer directory (schools find you)',
  '"SafeSchool Certified Installer" credential',
  'Access to certified hardware at installer pricing (through manufacturers)',
  'Ongoing technical support',
  'Business referrals from SafeSchool',
];

const trainingSteps = [
  { title: 'Online Course', desc: 'Self-paced training covering the SafeSchool platform, hardware integration, and best practices.' },
  { title: 'Regional Training', desc: 'In-person hands-on training with certified hardware at regional events.' },
  { title: 'Practical Exam', desc: 'Demonstrate your ability to install, configure, and troubleshoot a complete SafeSchool deployment.' },
];

export default function IntegratorsPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 md:py-32 px-6 text-center">
        <div className="mx-auto max-w-content">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-4">
            For Security Integrators
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-[1.1] tracking-[-0.02em] text-balance">
            Build Your Business on School Safety.
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-[640px] mx-auto">
            Schools using SafeSchool need certified installers. Get trained, get certified, get listed in the directory where schools find you.
          </p>
          <div className="mt-10">
            <Link
              href="/contact"
              className="inline-flex items-center px-8 py-3.5 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors"
            >
              Get Certified
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
              As schools adopt SafeSchool, they need professional installers to deploy and configure the system.
              Become a certified installer and tap into a growing market of schools that need your expertise.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="Benefits" />
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <ul className="space-y-4 max-w-lg mx-auto">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-teal-500 mt-0.5 flex-shrink-0" />
                  <span className="text-slate-700">{b}</span>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        </div>
      </section>

      {/* Training Program */}
      <section className="py-section px-6">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="Training Program" />
          </ScrollReveal>
          <div className="space-y-6">
            {trainingSteps.map((step, i) => (
              <ScrollReveal key={step.title} delay={i * 0.1}>
                <div className="bg-white border border-slate-200 rounded-card p-6">
                  <h4 className="font-bold text-navy-700 mb-2">{step.title}</h4>
                  <p className="text-sm text-slate-600">{step.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <CTABanner
        headline="Ready to become a certified installer?"
        primaryCTA={{ label: 'Get Certified', href: '/contact' }}
        secondaryCTA={{ label: 'View Hardware Directory', href: '/directory/hardware' }}
      />
    </>
  );
}

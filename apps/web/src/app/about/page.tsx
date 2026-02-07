import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { CTABanner } from '@/components/sections/CTABanner';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { teamMembers } from '@/content/data/team';
import { CONTACT_EMAIL, GITHUB_URL } from '@/lib/constants';
import { User, Github } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata('about');

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 md:py-32 px-6 text-center">
        <div className="mx-auto max-w-content">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-4">
            About SafeSchool
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-[1.1] tracking-[-0.02em] text-balance">
            Our Mission
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-[640px] mx-auto">
            SafeSchool exists to ensure every school in America has access to the best safety technology, regardless of budget.
          </p>
        </div>
      </section>

      {/* The Story */}
      <section className="py-section px-6">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="The Story" />
            <div className="prose prose-slate max-w-none text-center">
              <p className="text-lg text-slate-700 leading-relaxed">
                A 20-year QA veteran saw the problem from inside the access control industry: schools stuck
                with expensive, proprietary safety systems that didn&apos;t talk to each other. Small manufacturers
                locked out because building complete software stacks costs millions. And students paying the price.
              </p>
              <p className="text-lg text-slate-700 leading-relaxed mt-4">
                SafeSchool was built to fix this. By creating a universal, open standard for school safety
                technology, we give every school access to enterprise-grade protection for free — funded by
                manufacturer memberships, built with AI-assisted development, and open source from day one.
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Team */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-content">
          <ScrollReveal>
            <SectionHeading title="Leadership" />
          </ScrollReveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {teamMembers.map((member, i) => (
              <ScrollReveal key={member.name} delay={i * 0.1}>
                <div className="bg-white border border-slate-200 rounded-card p-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <User className="w-8 h-8 text-slate-400" />
                  </div>
                  <h4 className="font-bold text-navy-700">{member.name}</h4>
                  <p className="text-sm text-teal-600 font-medium mt-1">{member.role}</p>
                  <p className="text-sm text-slate-600 mt-3 leading-relaxed">{member.bio}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Transparency */}
      <section className="py-section px-6">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="Transparency" />
            <p className="text-center text-lg text-slate-700 leading-relaxed">
              We publish annual reports showing exactly how membership fees are used. Every dollar goes to
              platform development, hosting, and the certification program. No hidden costs. No surprises.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Open Source */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-narrow text-center">
          <ScrollReveal>
            <SectionHeading title="Open Source Philosophy" />
            <p className="text-lg text-slate-700 leading-relaxed mb-6">
              SafeSchool is licensed under AGPL because school safety technology should be transparent,
              auditable, and community-driven. When lives are at stake, closed-source black boxes aren&apos;t good enough.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-navy-700 text-white text-sm font-semibold rounded-button hover:bg-navy-600 transition-colors"
            >
              <Github className="w-4 h-4" />
              View on GitHub
            </a>
          </ScrollReveal>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="py-16 px-6">
        <div className="mx-auto max-w-narrow text-center">
          <ScrollReveal>
            <p className="text-slate-600 mb-2">Get in touch</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-xl font-bold text-teal-600 hover:text-teal-700">
              {CONTACT_EMAIL}
            </a>
          </ScrollReveal>
        </div>
      </section>

      <CTABanner />
    </>
  );
}

import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { ContactForm } from '@/components/forms/ContactForm';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { CONTACT_EMAIL } from '@/lib/constants';
import { Mail } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata('contact');

export default function ContactPage() {
  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Get In Touch
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[500px] mx-auto">
            Questions about SafeSchool? Want to learn more? We&apos;d love to hear from you.
          </p>
        </div>
      </section>

      <section className="py-section px-6">
        <div className="mx-auto max-w-[600px]">
          <ScrollReveal>
            <div className="bg-white border border-slate-200 rounded-card p-8 shadow-card">
              <ContactForm />
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.2}>
            <div className="mt-8 text-center">
              <p className="text-sm text-slate-500 mb-2">Or email us directly:</p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 font-semibold"
              >
                <Mail className="w-4 h-4" />
                {CONTACT_EMAIL}
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

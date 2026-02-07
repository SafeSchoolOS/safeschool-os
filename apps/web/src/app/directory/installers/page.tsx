import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { MapPin, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = generatePageMetadata('installer-directory');

export default function InstallerDirectoryPage() {
  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Certified Installer Directory
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[600px] mx-auto">
            Find a SafeSchool-certified installer in your area. Every installer listed here has been trained and tested.
          </p>
        </div>
      </section>

      <section className="py-section px-6">
        <div className="mx-auto max-w-content">
          <ScrollReveal>
            <SectionHeading
              title="Coming Soon"
              subtitle="We're building our certified installer network. The first certified installers will be listed here as the program launches."
            />
          </ScrollReveal>

          <ScrollReveal delay={0.1}>
            <div className="max-w-lg mx-auto">
              <div className="border-2 border-dashed border-slate-200 rounded-card p-12 text-center">
                <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="font-bold text-navy-700 mb-2">Installer Directory Launching Q2 2026</h3>
                <p className="text-sm text-slate-600 mb-6">
                  Interested in becoming a certified SafeSchool installer? Get trained, get certified, and be among the first listed.
                </p>
                <Link
                  href="/integrators"
                  className="inline-flex items-center px-6 py-2.5 bg-teal-500 text-white text-sm font-semibold rounded-button hover:bg-teal-600 transition-colors"
                >
                  Learn About Certification
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

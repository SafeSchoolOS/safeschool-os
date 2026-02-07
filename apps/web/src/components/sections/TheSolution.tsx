import Link from 'next/link';
import { School, Factory, Wrench } from 'lucide-react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';

const columns = [
  {
    icon: <School className="w-8 h-8 text-teal-500" />,
    title: 'For Schools',
    features: [
      '100% free platform',
      'Any certified hardware',
      'Vendor neutral',
      "Alyssa's Law compliant",
      'Cloud hosted, maintained for you',
    ],
    cta: { label: 'Learn More', href: '/schools' },
  },
  {
    icon: <Factory className="w-8 h-8 text-teal-500" />,
    title: 'For Manufacturers',
    features: [
      'Market access to thousands of schools',
      'No software to build',
      'Certification included',
      'Directory listing',
      'Brand visibility',
    ],
    cta: { label: 'Learn More', href: '/manufacturers' },
  },
  {
    icon: <Wrench className="w-8 h-8 text-teal-500" />,
    title: 'For Integrators',
    features: [
      'New revenue stream from installation',
      'Training program',
      'Certified installer directory listing',
      'Business referrals',
      'Technical support',
    ],
    cta: { label: 'Learn More', href: '/integrators' },
  },
];

export function TheSolution() {
  return (
    <section className="py-section px-6 bg-slate-50">
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading
            title="The Solution"
            subtitle="SafeSchool creates a universal standard — like USB for school safety. Any certified hardware works with the platform. Schools choose the best hardware for their needs. Manufacturers compete on quality, not lock-in."
          />
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-6">
          {columns.map((col, i) => (
            <ScrollReveal key={col.title} delay={i * 0.1}>
              <div className="bg-white rounded-card border border-slate-200 p-8 h-full flex flex-col hover:shadow-card-hover hover:border-teal-200 transition-all duration-200">
                <div className="mb-4">{col.icon}</div>
                <h3 className="text-xl font-bold text-navy-700 mb-4">{col.title}</h3>
                <ul className="space-y-2 flex-1 mb-6">
                  {col.features.map((f) => (
                    <li key={f} className="text-sm text-slate-600 flex items-start gap-2">
                      <span className="text-teal-500 mt-1">&#10003;</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={col.cta.href}
                  className="text-sm font-semibold text-teal-600 hover:text-teal-700 transition-colors"
                >
                  {col.cta.label} &rarr;
                </Link>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

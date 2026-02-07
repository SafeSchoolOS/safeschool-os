import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { pricingTiers } from '@/content/data/pricing-tiers';

export function PricingSection() {
  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading
            title="Membership Tiers"
            subtitle="Join the SafeSchool ecosystem. Fund the platform. Get your hardware into schools."
          />
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {pricingTiers.map((tier, i) => (
            <ScrollReveal key={tier.name} delay={i * 0.1}>
              <div
                className={cn(
                  'relative rounded-card border p-8 h-full flex flex-col',
                  tier.highlighted
                    ? 'border-teal-500 shadow-card-hover ring-1 ring-teal-500'
                    : 'border-slate-200',
                )}
              >
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-500 text-white text-xs font-bold px-3 py-1 rounded-pill">
                    {tier.badge}
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-navy-700 uppercase tracking-wider">
                    {tier.name}
                  </h3>
                  <div className="mt-3">
                    <span className="text-3xl font-extrabold text-navy-700">{tier.price}</span>
                    <span className="text-slate-500">{tier.period}</span>
                  </div>
                </div>

                <ul className="space-y-3 flex-1 mb-8">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-teal-500 mt-0.5 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/membership"
                  className={cn(
                    'block text-center py-3 rounded-button font-semibold transition-all',
                    tier.highlighted
                      ? 'bg-teal-500 text-white hover:bg-teal-600'
                      : 'border-2 border-navy-700 text-navy-700 hover:bg-navy-50',
                  )}
                >
                  Apply &rarr;
                </Link>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ScrollReveal } from '@/components/common/ScrollReveal';

interface CTABannerProps {
  headline?: string;
  description?: string;
  primaryCTA?: { label: string; href: string };
  secondaryCTA?: { label: string; href: string };
  theme?: 'navy' | 'teal';
}

export function CTABanner({
  headline,
  primaryCTA = { label: "Get Started — It's Free", href: '/schools' },
  secondaryCTA = { label: 'Become a Member', href: '/membership' },
  theme = 'navy',
}: CTABannerProps) {
  return (
    <section className={cn('py-16 px-6', theme === 'navy' ? 'bg-navy-700' : 'bg-teal-500')}>
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              {headline ? (
                <h2 className="text-2xl md:text-3xl font-bold text-white">
                  {headline}
                </h2>
              ) : (
                <div className="space-y-2">
                  <h2 className="text-2xl md:text-3xl font-bold text-white">
                    Ready to protect your school?
                  </h2>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href={primaryCTA.href}
                className="inline-flex items-center justify-center px-8 py-3.5 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 hover:scale-[1.02] transition-all"
              >
                {primaryCTA.label}
              </Link>
              <Link
                href={secondaryCTA.href}
                className="inline-flex items-center justify-center px-8 py-3.5 border-2 border-gold-400 text-gold-300 font-semibold rounded-button hover:bg-gold-500/10 transition-all"
              >
                {secondaryCTA.label}
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

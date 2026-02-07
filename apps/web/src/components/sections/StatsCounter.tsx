'use client';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { AnimatedCounter } from '@/components/common/AnimatedCounter';
import { cn } from '@/lib/utils';

interface Stat {
  value: number;
  suffix?: string;
  label: string;
}

interface StatsCounterProps {
  stats?: Stat[];
  theme?: 'teal' | 'navy';
}

const defaultStats: Stat[] = [
  { value: 0, suffix: '+', label: 'Schools Protected' },
  { value: 1, suffix: '', label: 'Manufacturers Certified' },
  { value: 9, suffix: '+', label: "States with Alyssa's Law" },
  { value: 99.9, suffix: '%', label: 'Uptime Target' },
];

export function StatsCounter({ stats = defaultStats, theme = 'teal' }: StatsCounterProps) {
  return (
    <section
      className={cn(
        'py-16 px-6',
        theme === 'teal' ? 'bg-teal-500' : 'bg-navy-700',
      )}
    >
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {stats.map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl md:text-4xl font-extrabold text-white mb-2">
                  <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                </div>
                <p className="text-sm font-medium text-white/80">{stat.label}</p>
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

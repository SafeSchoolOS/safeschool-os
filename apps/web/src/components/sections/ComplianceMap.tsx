'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { alyssaLawStates } from '@/content/data/compliance-states';

export function ComplianceMap() {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const hovered = alyssaLawStates.find((s) => s.code === hoveredState);

  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading
            title="Alyssa's Law Compliance Built In"
            subtitle="9+ states now require silent panic alarms in schools. SafeSchool meets every requirement, so you don't have to figure it out alone."
          />
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {alyssaLawStates
              .filter((s) => s.status === 'enacted')
              .map((state) => (
                <button
                  key={state.code}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-button border border-slate-200 bg-white text-sm font-medium text-navy-700 hover:border-teal-300 hover:bg-teal-50 transition-all"
                  onMouseEnter={() => setHoveredState(state.code)}
                  onMouseLeave={() => setHoveredState(null)}
                >
                  <CheckCircle className="w-4 h-4 text-teal-500" />
                  {state.code}
                </button>
              ))}
          </div>

          {hovered && (
            <div className="text-center mb-8 p-4 bg-slate-50 rounded-card max-w-lg mx-auto">
              <p className="font-semibold text-navy-700">{hovered.name}</p>
              <p className="text-sm text-slate-600 mt-1">{hovered.details}</p>
              {hovered.year && (
                <p className="text-xs text-slate-400 mt-1">Enacted {hovered.year}</p>
              )}
            </div>
          )}

          <div className="text-center">
            <Link
              href="/alyssa-law"
              className="text-sm font-semibold text-teal-600 hover:text-teal-700 transition-colors"
            >
              View Compliance Details &rarr;
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

import { X } from 'lucide-react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';

const problems = [
  'Proprietary silos that don\'t communicate',
  'Vendor lock-in with no exit strategy',
  'Small manufacturers shut out',
  'Schools overpaying for inflexible systems',
];

export function TheProblem() {
  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading title="The Problem" />
        </ScrollReveal>

        <div className="grid md:grid-cols-2 gap-12 items-center">
          <ScrollReveal delay={0.1}>
            <p className="text-lg text-slate-700 leading-relaxed mb-8">
              Schools face a fragmented landscape of proprietary safety systems that don&apos;t talk
              to each other. Hardware vendors are locked out of the market because building complete
              software stacks costs millions. And schools pay the price — stuck with expensive,
              inflexible systems from a single vendor.
            </p>
            <ul className="space-y-3">
              {problems.map((problem) => (
                <li key={problem} className="flex items-start gap-3 text-slate-700">
                  <X className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
                  {problem}
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <ScrollReveal delay={0.2}>
            {/* Abstract SVG illustration */}
            <div className="bg-slate-100 rounded-card p-12 flex items-center justify-center">
              <svg width="280" height="200" viewBox="0 0 280 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="20" y="20" width="60" height="60" rx="8" fill="#EEF1F5" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 4" />
                <rect x="110" y="20" width="60" height="60" rx="8" fill="#EEF1F5" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 4" />
                <rect x="200" y="20" width="60" height="60" rx="8" fill="#EEF1F5" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 4" />
                <rect x="65" y="120" width="60" height="60" rx="8" fill="#EEF1F5" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 4" />
                <rect x="155" y="120" width="60" height="60" rx="8" fill="#EEF1F5" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4 4" />
                <text x="50" y="55" textAnchor="middle" className="fill-slate-400 text-xs">Vendor A</text>
                <text x="140" y="55" textAnchor="middle" className="fill-slate-400 text-xs">Vendor B</text>
                <text x="230" y="55" textAnchor="middle" className="fill-slate-400 text-xs">Vendor C</text>
                <text x="95" y="155" textAnchor="middle" className="fill-slate-400 text-xs">Vendor D</text>
                <text x="185" y="155" textAnchor="middle" className="fill-slate-400 text-xs">Vendor E</text>
              </svg>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

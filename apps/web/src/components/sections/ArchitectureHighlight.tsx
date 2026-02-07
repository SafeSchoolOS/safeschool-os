import { Blocks, FileCode, Search, ShieldCheck } from 'lucide-react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';

const cards = [
  {
    icon: <Blocks className="w-6 h-6 text-teal-500" />,
    title: 'Modular Architecture',
    description: 'Every service independently deployable and testable. Plugin system for extensions.',
  },
  {
    icon: <FileCode className="w-6 h-6 text-teal-500" />,
    title: 'Fully Documented APIs',
    description: 'OpenAPI 3.0 spec. Versioned endpoints. Error catalogs. SDK-ready for integrations.',
  },
  {
    icon: <Search className="w-6 h-6 text-teal-500" />,
    title: 'Troubleshootable by Design',
    description: 'Correlation IDs trace every request end-to-end. Structured logging. Per-module debug mode.',
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-teal-500" />,
    title: 'Reliability First',
    description: '99.9% uptime target. Per-module health checks. Automated regression testing.',
  },
];

export function ArchitectureHighlight() {
  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading
            title="Enterprise-Grade Engineering"
            subtitle="SafeSchool isn't a weekend project. It's a modular, framework-centric platform built to life-safety standards."
          />
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((card, i) => (
            <ScrollReveal key={card.title} delay={i * 0.1}>
              <div className="bg-white rounded-card border border-slate-200 p-6 h-full hover:shadow-card-hover hover:border-teal-200 transition-all duration-200">
                <div className="mb-3">{card.icon}</div>
                <h3 className="text-base font-bold text-navy-700 mb-2">{card.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{card.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.3}>
          <div className="mt-8 flex flex-wrap gap-4 justify-center">
            <a
              href="/developers"
              className="text-sm font-semibold text-teal-600 hover:text-teal-700 transition-colors"
            >
              View Technical Documentation &rarr;
            </a>
            <a
              href="https://github.com/safeschool/safeschool"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-navy-700 hover:text-navy-600 transition-colors"
            >
              View on GitHub &rarr;
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

import { Github, Star, GitFork, Users } from 'lucide-react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { GITHUB_URL } from '@/lib/constants';

export function OpenSource() {
  return (
    <section className="py-section px-6 bg-slate-50">
      <div className="mx-auto max-w-content text-center">
        <ScrollReveal>
          <SectionHeading
            title="Open Source & Community Driven"
            subtitle="SafeSchool is open source under the AGPL license. Inspect the code. Contribute improvements. Trust what protects your school."
          />
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-card px-6 py-3 mb-8">
            <Github className="w-5 h-5 text-slate-700" />
            <span className="text-sm font-mono text-slate-700">github.com/safeschool/safeschool</span>
          </div>

          <div className="flex justify-center gap-8 mb-8">
            <div className="flex items-center gap-2 text-slate-600">
              <Star className="w-4 h-4" />
              <span className="text-sm font-medium">Stars</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <GitFork className="w-4 h-4" />
              <span className="text-sm font-medium">Forks</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">Contributors</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-2.5 bg-navy-700 text-white text-sm font-semibold rounded-button hover:bg-navy-600 transition-colors"
            >
              View on GitHub
            </a>
            <a
              href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-2.5 border-2 border-navy-700 text-navy-700 text-sm font-semibold rounded-button hover:bg-navy-50 transition-colors"
            >
              Contributing Guide
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

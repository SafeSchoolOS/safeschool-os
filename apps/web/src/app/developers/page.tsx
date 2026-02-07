import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { GITHUB_URL } from '@/lib/constants';
import { Github, BookOpen, Code, MessageSquare } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata('developers');

const resources = [
  {
    icon: <BookOpen className="w-6 h-6 text-teal-500" />,
    title: 'Documentation',
    desc: 'Comprehensive guides for the SafeSchool API, adapter development, and deployment.',
    href: `${GITHUB_URL}/wiki`,
  },
  {
    icon: <Code className="w-6 h-6 text-teal-500" />,
    title: 'API Reference',
    desc: 'OpenAPI 3.0 specification covering all REST endpoints, WebSocket events, and error codes.',
    href: `${GITHUB_URL}/blob/main/docs/api.md`,
  },
  {
    icon: <Github className="w-6 h-6 text-teal-500" />,
    title: 'Source Code',
    desc: 'Full source code under AGPL. TypeScript monorepo with Fastify, React, and Prisma.',
    href: GITHUB_URL,
  },
  {
    icon: <MessageSquare className="w-6 h-6 text-teal-500" />,
    title: 'Contributing Guide',
    desc: 'How to set up the dev environment, submit PRs, and follow our coding standards.',
    href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`,
  },
];

export default function DevelopersPage() {
  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-4">
            Open Source
          </p>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Built for Developers
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[600px] mx-auto">
            SafeSchool is open source under AGPL. Build integrations, contribute improvements, or deploy your own instance.
          </p>
          <div className="mt-8">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-navy-700 font-semibold rounded-button hover:bg-slate-100 transition-colors"
            >
              <Github className="w-5 h-5" />
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="py-section px-6">
        <div className="mx-auto max-w-content">
          <ScrollReveal>
            <SectionHeading title="Developer Resources" />
          </ScrollReveal>
          <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {resources.map((r, i) => (
              <ScrollReveal key={r.title} delay={i * 0.1}>
                <a
                  href={r.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-white border border-slate-200 rounded-card p-6 hover:shadow-card-hover hover:border-teal-200 transition-all"
                >
                  <div className="mb-3">{r.icon}</div>
                  <h3 className="font-bold text-navy-700 mb-2">{r.title}</h3>
                  <p className="text-sm text-slate-600">{r.desc}</p>
                </a>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-section px-6 bg-slate-50">
        <div className="mx-auto max-w-narrow">
          <ScrollReveal>
            <SectionHeading title="Technology Stack" />
            <div className="grid grid-cols-2 gap-4">
              {[
                { name: 'TypeScript', desc: 'End-to-end type safety' },
                { name: 'Fastify 5', desc: 'High-performance API framework' },
                { name: 'React 19', desc: 'Dashboard & kiosk apps' },
                { name: 'PostgreSQL', desc: 'Primary database with Prisma ORM' },
                { name: 'Redis', desc: 'Caching, pub/sub, job queues' },
                { name: 'BullMQ', desc: 'Background job processing' },
                { name: 'Turborepo', desc: 'Monorepo build orchestration' },
                { name: 'Expo', desc: 'Cross-platform mobile app' },
              ].map((tech) => (
                <div key={tech.name} className="bg-white border border-slate-200 rounded-card p-4">
                  <p className="font-mono text-sm font-medium text-navy-700">{tech.name}</p>
                  <p className="text-xs text-slate-500 mt-1">{tech.desc}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

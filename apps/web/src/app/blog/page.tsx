import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { Calendar, Clock } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = generatePageMetadata('blog');

const posts = [
  {
    slug: 'welcome-to-safeschool',
    title: 'Welcome to SafeSchool: The Open Standard for School Safety',
    excerpt: 'Introducing SafeSchool — a free, open source platform that unifies school safety technology from any hardware manufacturer.',
    date: 'February 2026',
    readTime: '5 min read',
    category: 'Announcements',
  },
  {
    slug: 'alyssas-law-explained',
    title: "What Is Alyssa's Law and What Does It Mean for Your School?",
    excerpt: "A comprehensive guide to Alyssa's Law requirements across all enacted states, and how SafeSchool helps you comply.",
    date: 'February 2026',
    readTime: '8 min read',
    category: "Alyssa's Law",
  },
  {
    slug: 'why-open-source-school-safety',
    title: 'Why Open Source Matters for School Safety Technology',
    excerpt: 'When lives are at stake, proprietary black boxes aren\'t good enough. Here\'s why SafeSchool is open source.',
    date: 'February 2026',
    readTime: '6 min read',
    category: 'Technical',
  },
];

export default function BlogPage() {
  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Blog
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[500px] mx-auto">
            News, insights, and thought leadership on school safety technology.
          </p>
        </div>
      </section>

      <section className="py-section px-6">
        <div className="mx-auto max-w-content">
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {posts.map((post, i) => (
              <ScrollReveal key={post.slug} delay={i * 0.1}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="block bg-white border border-slate-200 rounded-card p-6 hover:shadow-card-hover hover:border-teal-200 transition-all h-full"
                >
                  <span className="text-xs font-semibold text-teal-600 uppercase tracking-wider">
                    {post.category}
                  </span>
                  <h3 className="text-lg font-bold text-navy-700 mt-2 mb-3">{post.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed mb-4">{post.excerpt}</p>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {post.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {post.readTime}
                    </span>
                  </div>
                </Link>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

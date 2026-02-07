import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const blogContent: Record<string, { title: string; date: string; category: string; content: string }> = {
  'welcome-to-safeschool': {
    title: 'Welcome to SafeSchool: The Open Standard for School Safety',
    date: 'February 2026',
    category: 'Announcements',
    content: `SafeSchool is a free, open source platform that unifies school safety technology from any hardware manufacturer into one universal standard.

For too long, schools have been stuck with proprietary, siloed safety systems that don't communicate with each other. Hardware manufacturers are locked out of the market because building complete software stacks costs millions. And schools pay the price — stuck with expensive, inflexible systems from a single vendor.

SafeSchool changes this. We've created a universal standard — like USB for school safety. Any certified hardware works with the platform. Schools choose the best hardware for their needs. Manufacturers compete on quality, not lock-in.

The platform includes unified access control, emergency panic alerts with indoor location tracking, direct 911 dispatch, visitor management, student transportation tracking, and AI-powered threat intelligence. All compliant with Alyssa's Law requirements across every enacted state.

And it's 100% free for schools. Funded by manufacturer memberships, built with AI-assisted development, and open source from day one under the AGPL license.

We're just getting started, but the vision is clear: every school in America protected by the best safety technology available, regardless of budget.`,
  },
  'alyssas-law-explained': {
    title: "What Is Alyssa's Law and What Does It Mean for Your School?",
    date: 'February 2026',
    category: "Alyssa's Law",
    content: `Named after Alyssa Alhadeff, one of the 17 victims of the February 2018 mass shooting at Marjory Stoneman Douglas High School in Parkland, Florida, Alyssa's Law requires schools to install silent panic alarms that directly connect to local law enforcement.

As of 2024, nine states have enacted some form of Alyssa's Law: New Jersey, Florida, New York, Texas, Oklahoma, Tennessee, Virginia, Arizona, and North Carolina. More states are expected to follow.

The core requirements are consistent across states: schools must have silent panic alarm systems that immediately notify 911/PSAP when activated, transmit the location of the emergency, and do not create an audible alarm that could alert an intruder.

SafeSchool was built from the ground up to meet every one of these requirements. Our platform provides silent panic buttons (wearable and mobile), direct 911 dispatch via NENA i3 standards, real-time indoor location tracking, automated lockdown capabilities, and dual-path dispatch with cellular failover.

If your state has enacted Alyssa's Law or is considering it, SafeSchool ensures you're compliant on day one — at zero cost.`,
  },
  'why-open-source-school-safety': {
    title: 'Why Open Source Matters for School Safety Technology',
    date: 'February 2026',
    category: 'Technical',
    content: `When a panic button is pressed in a school, there is zero room for software bugs, hidden vulnerabilities, or untested edge cases. Lives depend on every line of code working exactly as intended.

That's why SafeSchool is open source under the AGPL license.

Open source means every school district, every security researcher, every concerned parent can inspect the code that protects their children. There are no black boxes. No "trust us, it works." Just transparent, auditable code that the community can verify and improve.

The security industry has long relied on "security through obscurity" — hiding code behind proprietary licenses and hoping no one finds the bugs. But we've learned time and again that this approach fails. The most secure software in the world — Linux, OpenSSL, Signal Protocol — is open source.

We chose AGPL specifically because it ensures that any organization that modifies SafeSchool and offers it as a service must share those modifications with the community. This prevents large companies from taking our code, adding proprietary features, and locking schools back into silos.

Open source also means that if SafeSchool Foundation ever stopped operating, the code would live on. Schools would never be left without their safety system because a company went bankrupt or was acquired.

This is too important to be proprietary.`,
  },
};

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = blogContent[slug];

  if (!post) {
    return (
      <section className="py-section px-6">
        <div className="mx-auto max-w-narrow text-center">
          <h1 className="text-2xl font-bold text-navy-700 mb-4">Post Not Found</h1>
          <Link href="/blog" className="text-teal-600 hover:text-teal-700 font-semibold">
            &larr; Back to Blog
          </Link>
        </div>
      </section>
    );
  }

  return (
    <article className="py-section px-6">
      <div className="mx-auto max-w-narrow">
        <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-600 mb-8">
          <ArrowLeft className="w-4 h-4" />
          Back to Blog
        </Link>

        <span className="text-xs font-semibold text-teal-600 uppercase tracking-wider">
          {post.category}
        </span>
        <h1 className="text-3xl md:text-4xl font-bold text-navy-700 mt-2 mb-4 leading-tight">
          {post.title}
        </h1>
        <p className="text-sm text-slate-400 mb-10">{post.date}</p>

        <div className="prose prose-slate max-w-none">
          {post.content.split('\n\n').map((paragraph, i) => (
            <p key={i} className="text-slate-700 leading-relaxed mb-4">
              {paragraph}
            </p>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link href="/blog" className="text-sm font-semibold text-teal-600 hover:text-teal-700">
            &larr; Back to Blog
          </Link>
        </div>
      </div>
    </article>
  );
}

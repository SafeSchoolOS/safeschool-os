'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { foundingMembers } from '@/content/data/founding-members';

export function Hero() {
  return (
    <section className="relative bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 overflow-hidden">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative mx-auto max-w-content px-6 py-24 md:py-32 lg:py-40 text-center">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-400 mb-6"
        >
          The Open Standard for School Safety
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-4xl sm:text-5xl lg:text-[72px] font-extrabold text-white leading-[1.1] tracking-[-0.02em] text-balance"
        >
          Every School Protected.
          <br />
          Every Manufacturer Welcome.
          <br />
          <span className="text-teal-400">Zero Cost.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="mt-6 text-lg md:text-xl text-slate-300 max-w-[640px] mx-auto leading-relaxed"
        >
          SafeSchool is a free, open source platform that unifies school safety technology from any
          hardware manufacturer into one universal standard.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link
            href="/schools"
            className="inline-flex items-center justify-center px-8 py-3.5 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 hover:scale-[1.02] transition-all shadow-lg"
          >
            I&apos;m a School
          </Link>
          <Link
            href="/manufacturers"
            className="inline-flex items-center justify-center px-8 py-3.5 border-2 border-white/30 text-white font-semibold rounded-button hover:bg-white/10 hover:border-white/50 transition-all"
          >
            I&apos;m a Manufacturer
          </Link>
        </motion.div>

        {/* Founding members */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.5 }}
          className="mt-16"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
            Sponsored by Our Founding Members
          </p>
          <div className="flex items-center justify-center gap-6">
            {foundingMembers.map((member) => (
              <a
                key={member.slug}
                href={member.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
              >
                <span className="font-semibold">{member.name}</span>
                {member.tier === 'charter' && (
                  <span className="text-[10px] font-bold uppercase bg-gold-500 text-navy-900 px-1.5 py-0.5 rounded">
                    Charter
                  </span>
                )}
              </a>
            ))}
          </div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 8, 0] }}
          transition={{ opacity: { delay: 1 }, y: { repeat: Infinity, duration: 2 } }}
          className="mt-12"
        >
          <ChevronDown className="w-6 h-6 text-slate-500 mx-auto" />
        </motion.div>
      </div>
    </section>
  );
}

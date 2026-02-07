import Link from 'next/link';
import { Shield } from 'lucide-react';
import { FOOTER_LINKS, CONTACT_EMAIL, SITE_NAME } from '@/lib/constants';
import { foundingMembers } from '@/content/data/founding-members';
import { techPartners } from '@/content/data/tech-partners';

export function Footer() {
  return (
    <footer className="bg-navy-700 text-slate-400">
      <div className="mx-auto max-w-content px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* Branding */}
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-lg mb-3">
              <Shield className="w-6 h-6 text-teal-400" />
              SafeSchool
            </div>
            <p className="text-sm leading-relaxed mb-4">
              The open standard for school safety technology.
            </p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm text-slate-300 hover:text-white transition-colors">
              {CONTACT_EMAIL}
            </a>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Platform</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.platform.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-300 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Community */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Community</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.community.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-slate-300 hover:text-white transition-colors"
                    {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Legal</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-300 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Sponsors */}
        <div className="border-t border-navy-600 pt-8 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
            Sponsored by Our Founding Members
          </p>
          <div className="flex items-center gap-6 flex-wrap">
            {foundingMembers.map((member) => (
              <a
                key={member.slug}
                href={member.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
              >
                <span className="font-semibold text-sm">{member.name}</span>
                {member.tier === 'charter' && (
                  <span className="text-[10px] font-bold uppercase bg-gold-500 text-navy-900 px-1.5 py-0.5 rounded">
                    Charter
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>

        {/* Tech partners */}
        <div className="border-t border-navy-600 pt-8 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
            Built With
          </p>
          <div className="flex items-center gap-6 flex-wrap">
            {techPartners.map((partner) => (
              <a
                key={partner.name}
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-slate-300 hover:text-white transition-colors"
              >
                {partner.name}
              </a>
            ))}
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-navy-600 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} {SITE_NAME}. Open source under AGPL.
          </p>
          <a
            href="https://github.com/safeschool/safeschool"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

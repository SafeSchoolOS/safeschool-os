'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ChevronDown, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_LINKS } from '@/lib/constants';

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setDropdownOpen(false);
  }, [pathname]);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 bg-white transition-shadow duration-200',
        scrolled && 'shadow-nav',
      )}
    >
      <nav className="mx-auto max-w-content px-6 h-[72px] flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-navy-700 font-bold text-xl">
          <Shield className="w-7 h-7 text-teal-500" />
          SafeSchool
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((link) =>
            'children' in link && link.children ? (
              <div key={link.label} className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-1 text-[15px] font-medium text-slate-700 hover:text-navy-700 transition-colors"
                >
                  {link.label}
                  <ChevronDown className={cn('w-4 h-4 transition-transform', dropdownOpen && 'rotate-180')} />
                </button>
                {dropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-44 bg-white rounded-card shadow-card-hover border border-slate-200 py-2">
                    {link.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-teal-600"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'text-[15px] font-medium transition-colors',
                  pathname === link.href ? 'text-teal-600' : 'text-slate-700 hover:text-navy-700',
                )}
              >
                {link.label}
              </Link>
            ),
          )}
        </div>

        {/* CTA */}
        <div className="hidden lg:flex items-center gap-4">
          <Link
            href="/login"
            className="text-[15px] font-medium text-slate-700 hover:text-navy-700 transition-colors"
          >
            Login
          </Link>
          <Link
            href="/schools"
            className="inline-flex items-center px-5 py-2.5 bg-teal-500 text-white text-[15px] font-semibold rounded-button hover:bg-teal-600 transition-colors"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 text-slate-700"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-white border-t border-slate-200 px-6 py-6 space-y-4">
          {NAV_LINKS.map((link) =>
            'children' in link && link.children ? (
              <div key={link.label} className="space-y-2">
                <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                  {link.label}
                </span>
                {link.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className="block pl-4 py-2 text-slate-700 hover:text-teal-600"
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="block py-2 text-slate-700 hover:text-teal-600 font-medium"
              >
                {link.label}
              </Link>
            ),
          )}
          <Link
            href="/login"
            className="block py-2 text-slate-700 hover:text-teal-600 font-medium"
          >
            Login
          </Link>
          <Link
            href="/schools"
            className="block w-full text-center px-5 py-3 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors"
          >
            Get Started
          </Link>
        </div>
      )}
    </header>
  );
}

import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';
import { CertifiedBadge } from '@/components/common/CertifiedBadge';
import { foundingMembers } from '@/content/data/founding-members';
import { ShieldCheck } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata('hardware-directory');

const products = [
  {
    name: 'Sicunet SR-200 Smart Reader',
    manufacturer: 'Sicunet',
    type: 'Access Control Reader',
    features: ['BLE', 'PoE', 'OSDP'],
    certifiedDate: 'March 2026',
    charter: true,
  },
  {
    name: 'Sicunet SP-100 Smart Panel',
    manufacturer: 'Sicunet',
    type: 'Access Control Panel',
    features: ['8-Door', 'PoE+', 'Encrypted'],
    certifiedDate: 'March 2026',
    charter: true,
  },
];

export default function HardwareDirectoryPage() {
  return (
    <>
      <section className="bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900 py-24 px-6 text-center">
        <div className="mx-auto max-w-content">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Certified Hardware Directory
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-[600px] mx-auto">
            Every product listed here has been tested and certified to work with SafeSchool.
          </p>
        </div>
      </section>

      <section className="py-section px-6">
        <div className="mx-auto max-w-content">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product, i) => (
              <ScrollReveal key={product.name} delay={i * 0.1}>
                <div className="bg-white border border-slate-200 rounded-card overflow-hidden hover:shadow-card-hover hover:border-teal-200 transition-all">
                  <div className="bg-slate-100 h-40 flex items-center justify-center">
                    <ShieldCheck className="w-12 h-12 text-slate-300" />
                  </div>
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-bold text-navy-700">{product.name}</h3>
                      {product.charter && <CertifiedBadge variant="charter" size="sm" />}
                    </div>
                    <p className="text-sm text-slate-600 mb-1">
                      <span className="font-medium">Manufacturer:</span> {product.manufacturer}
                    </p>
                    <p className="text-sm text-slate-600 mb-3">
                      <span className="font-medium">Type:</span> {product.type}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {product.features.map((f) => (
                        <span key={f} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-badge">
                          {f}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-teal-600">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span className="font-medium">SafeSchool Certified</span>
                      <span className="text-slate-400">&#183; {product.certifiedDate}</span>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            ))}

            {/* Placeholder for future products */}
            <ScrollReveal delay={0.3}>
              <div className="border-2 border-dashed border-slate-200 rounded-card h-full min-h-[300px] flex items-center justify-center p-6">
                <div className="text-center">
                  <p className="text-slate-400 font-medium mb-2">More products coming soon</p>
                  <a href="/manufacturers" className="text-sm text-teal-600 hover:text-teal-700 font-semibold">
                    Become a member &rarr;
                  </a>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>
    </>
  );
}

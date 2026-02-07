import type { Metadata } from 'next';
import { SITE_NAME, CONTACT_EMAIL } from '@/lib/constants';

export const metadata: Metadata = {
  title: `Terms of Service | ${SITE_NAME}`,
};

export default function TermsPage() {
  return (
    <article className="py-section px-6">
      <div className="mx-auto max-w-narrow prose prose-slate">
        <h1 className="text-navy-700">Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: February 2026</p>

        <h2>About SafeSchool</h2>
        <p>
          SafeSchool Foundation provides a free, open source school safety platform. The SafeSchool
          software is licensed under the GNU Affero General Public License version 3 (AGPL-3.0).
        </p>

        <h2>Use of the Platform</h2>
        <p>
          The SafeSchool platform is provided free of charge to schools and school districts.
          By using SafeSchool, you agree to use it solely for its intended purpose of school
          safety management.
        </p>

        <h2>Manufacturer Membership</h2>
        <p>
          Hardware manufacturers may join SafeSchool through a paid membership program. Membership
          terms, including pricing, certification requirements, and directory listing terms, are
          outlined in the membership agreement.
        </p>

        <h2>Open Source License</h2>
        <p>
          The SafeSchool source code is available under AGPL-3.0. This means you are free to use,
          modify, and distribute the software, provided that any modifications you make available
          as a network service are also made available under the same license.
        </p>

        <h2>Limitation of Liability</h2>
        <p>
          SafeSchool Foundation provides the platform &quot;as is&quot; without warranty of any kind.
          While we strive for 99.9% uptime and rigorous testing, school safety is a shared
          responsibility. SafeSchool should be one component of a comprehensive safety plan.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about these terms, contact{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </article>
  );
}

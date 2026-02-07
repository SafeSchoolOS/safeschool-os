import type { Metadata } from 'next';
import { SITE_NAME, CONTACT_EMAIL } from '@/lib/constants';

export const metadata: Metadata = {
  title: `Privacy Policy | ${SITE_NAME}`,
};

export default function PrivacyPage() {
  return (
    <article className="py-section px-6">
      <div className="mx-auto max-w-narrow prose prose-slate">
        <h1 className="text-navy-700">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: February 2026</p>

        <h2>Information We Collect</h2>
        <p>
          When you use the SafeSchool website, we may collect information you provide through
          contact forms, membership applications, and school interest forms. This includes your name,
          email address, organization, phone number, and any messages you submit.
        </p>

        <h2>How We Use Your Information</h2>
        <p>We use the information collected to:</p>
        <ul>
          <li>Respond to your inquiries and requests</li>
          <li>Process membership applications</li>
          <li>Send relevant updates about SafeSchool (with your consent)</li>
          <li>Improve our website and services</li>
        </ul>

        <h2>Data Protection</h2>
        <p>
          SafeSchool takes data protection seriously. We implement appropriate technical and
          organizational measures to protect your personal information. Student data processed
          through the SafeSchool platform is handled in compliance with FERPA regulations.
        </p>

        <h2>Third-Party Services</h2>
        <p>
          We may use third-party services for analytics (PostHog), email delivery (SendGrid/Resend),
          and hosting (Railway). These services have their own privacy policies.
        </p>

        <h2>Your Rights</h2>
        <p>
          You have the right to access, correct, or delete your personal information. Contact us
          at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> for any privacy-related requests.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about this privacy policy, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </article>
  );
}

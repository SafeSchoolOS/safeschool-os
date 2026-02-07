import { CreditCard, Brain } from 'lucide-react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';

const integrations = [
  {
    icon: <CreditCard className="w-8 h-8 text-teal-500" />,
    name: 'BadgeKiosk',
    tagline: 'Visitor Management',
    description:
      'Streamlined visitor check-in, badge printing, watchlist screening, and emergency lockdown notifications.',
    price: 'Starting at $200/month',
  },
  {
    icon: <Brain className="w-8 h-8 text-teal-500" />,
    name: 'AccessIQ',
    tagline: 'AI-Powered Analytics',
    description:
      'Detect anomalous access patterns. AI-powered alerts when credentials are used outside normal behavior. Real-time threat detection.',
    price: 'Starting at $300/month',
  },
];

export function PremiumIntegrations() {
  return (
    <section className="py-section px-6 bg-slate-50">
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading
            title="Premium Integrations"
            subtitle="Enhance SafeSchool with powerful add-ons from our ecosystem."
          />
        </ScrollReveal>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {integrations.map((item, i) => (
            <ScrollReveal key={item.name} delay={i * 0.1}>
              <div className="bg-white rounded-card border border-slate-200 p-8 h-full hover:shadow-card-hover hover:border-teal-200 transition-all duration-200">
                <div className="mb-4">{item.icon}</div>
                <h3 className="text-xl font-bold text-navy-700">{item.name}</h3>
                <p className="text-sm text-teal-600 font-medium mb-3">{item.tagline}</p>
                <p className="text-slate-600 mb-6 leading-relaxed">{item.description}</p>
                <p className="text-sm font-semibold text-navy-700">{item.price}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

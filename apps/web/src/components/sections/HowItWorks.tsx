import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';

const steps = [
  {
    number: 1,
    title: 'Schools sign up for free',
    description: 'Get the complete SafeSchool platform at zero cost. Cloud hosted. Always updated. Always free.',
  },
  {
    number: 2,
    title: 'Choose certified hardware',
    description: 'Browse the hardware directory. Pick readers, panic buttons, cameras from any certified manufacturer.',
  },
  {
    number: 3,
    title: 'Hire a certified installer',
    description: 'Find a trained, certified installer in your region. They configure everything.',
  },
  {
    number: 4,
    title: "You're protected",
    description: "Unified dashboard. Real-time alerts. Location tracking. Alyssa's Law compliant. Peace of mind.",
  },
];

export function HowItWorks() {
  return (
    <section className="py-section px-6">
      <div className="mx-auto max-w-narrow">
        <ScrollReveal>
          <SectionHeading title="How It Works" />
        </ScrollReveal>

        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-6 top-8 bottom-8 w-px bg-slate-200 hidden md:block" />

          <div className="space-y-10">
            {steps.map((step, i) => (
              <ScrollReveal key={step.number} delay={i * 0.1}>
                <div className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-teal-500 text-white flex items-center justify-center font-bold text-lg relative z-10">
                    {step.number}
                  </div>
                  <div className="pt-1">
                    <h3 className="text-lg font-bold text-navy-700 mb-1">{step.title}</h3>
                    <p className="text-slate-600">{step.description}</p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

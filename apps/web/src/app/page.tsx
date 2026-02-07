import { Hero } from '@/components/sections/Hero';
import { TheProblem } from '@/components/sections/TheProblem';
import { TheSolution } from '@/components/sections/TheSolution';
import { HowItWorks } from '@/components/sections/HowItWorks';
import { StatsCounter } from '@/components/sections/StatsCounter';
import { ArchitectureHighlight } from '@/components/sections/ArchitectureHighlight';
import { PremiumIntegrations } from '@/components/sections/PremiumIntegrations';
import { ComplianceMap } from '@/components/sections/ComplianceMap';
import { OpenSource } from '@/components/sections/OpenSource';
import { CTABanner } from '@/components/sections/CTABanner';

export default function HomePage() {
  return (
    <>
      <Hero />
      <TheProblem />
      <TheSolution />
      <HowItWorks />
      <StatsCounter />
      <ArchitectureHighlight />
      <PremiumIntegrations />
      <ComplianceMap />
      <OpenSource />
      <CTABanner />
    </>
  );
}

import {
  Shield, Bell, Radio, UserCheck, Bus, Eye,
  Wifi, MessageSquare, Building, CheckCircle, FileCheck, Phone, Cloud,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ScrollReveal } from '@/components/common/ScrollReveal';
import { SectionHeading } from '@/components/common/SectionHeading';

const iconMap: Record<string, ReactNode> = {
  Shield: <Shield className="w-6 h-6 text-teal-500" />,
  Bell: <Bell className="w-6 h-6 text-teal-500" />,
  Radio: <Radio className="w-6 h-6 text-teal-500" />,
  UserCheck: <UserCheck className="w-6 h-6 text-teal-500" />,
  Bus: <Bus className="w-6 h-6 text-teal-500" />,
  Eye: <Eye className="w-6 h-6 text-teal-500" />,
  Wifi: <Wifi className="w-6 h-6 text-teal-500" />,
  MessageSquare: <MessageSquare className="w-6 h-6 text-teal-500" />,
  Building: <Building className="w-6 h-6 text-teal-500" />,
  CheckCircle: <CheckCircle className="w-6 h-6 text-teal-500" />,
  FileCheck: <FileCheck className="w-6 h-6 text-teal-500" />,
  Phone: <Phone className="w-6 h-6 text-teal-500" />,
  Cloud: <Cloud className="w-6 h-6 text-teal-500" />,
};

interface FeatureGridProps {
  overline?: string;
  title: string;
  subtitle?: string;
  features: { icon: string; title: string; description: string }[];
  columns?: 2 | 3 | 4;
  bg?: 'white' | 'slate';
}

export function FeatureGrid({
  overline,
  title,
  subtitle,
  features,
  columns = 3,
  bg = 'white',
}: FeatureGridProps) {
  const colClass =
    columns === 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : columns === 2
        ? 'sm:grid-cols-2'
        : 'sm:grid-cols-2 lg:grid-cols-3';

  return (
    <section className={`py-section px-6 ${bg === 'slate' ? 'bg-slate-50' : ''}`}>
      <div className="mx-auto max-w-content">
        <ScrollReveal>
          <SectionHeading overline={overline} title={title} subtitle={subtitle} />
        </ScrollReveal>

        <div className={`grid ${colClass} gap-6`}>
          {features.map((feature, i) => (
            <ScrollReveal key={feature.title} delay={i * 0.05}>
              <div className="bg-white rounded-card border border-slate-200 p-6 h-full hover:shadow-card-hover hover:border-teal-200 transition-all duration-200">
                <div className="mb-3">{iconMap[feature.icon] || iconMap.Shield}</div>
                <h3 className="text-base font-bold text-navy-700 mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{feature.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

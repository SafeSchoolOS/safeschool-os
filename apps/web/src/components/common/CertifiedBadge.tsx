import { cn } from '@/lib/utils';
import { ShieldCheck, Star } from 'lucide-react';

interface CertifiedBadgeProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'charter';
}

export function CertifiedBadge({ size = 'md', variant = 'default' }: CertifiedBadgeProps) {
  const sizes = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-sm px-3 py-1 gap-1.5',
    lg: 'text-base px-4 py-1.5 gap-2',
  };
  const iconSizes = { sm: 12, md: 14, lg: 16 };

  if (variant === 'charter') {
    return (
      <span className={cn('inline-flex items-center rounded-badge font-semibold bg-gold-50 text-gold-700 border border-gold-300', sizes[size])}>
        <Star size={iconSizes[size]} className="fill-gold-500 text-gold-500" />
        Charter
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center rounded-badge font-semibold bg-teal-50 text-teal-700 border border-teal-200', sizes[size])}>
      <ShieldCheck size={iconSizes[size]} />
      Certified
    </span>
  );
}

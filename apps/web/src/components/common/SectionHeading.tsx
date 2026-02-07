import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  overline?: string;
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
  theme?: 'light' | 'dark';
}

export function SectionHeading({
  overline,
  title,
  subtitle,
  align = 'center',
  theme = 'light',
}: SectionHeadingProps) {
  return (
    <div className={cn('mb-10', align === 'center' && 'text-center')}>
      {overline && (
        <p
          className={cn(
            'text-xs font-semibold uppercase tracking-[0.08em] mb-3',
            theme === 'dark' ? 'text-teal-400' : 'text-teal-500',
          )}
        >
          {overline}
        </p>
      )}
      <h2
        className={cn(
          'text-3xl md:text-4xl font-bold tracking-tight',
          theme === 'dark' ? 'text-white' : 'text-navy-700',
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className={cn(
            'mt-4 text-lg max-w-2xl',
            align === 'center' && 'mx-auto',
            theme === 'dark' ? 'text-slate-300' : 'text-slate-600',
          )}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

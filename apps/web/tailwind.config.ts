import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        navy: {
          50: '#EEF1F5',
          100: '#D4DAE5',
          200: '#A9B5CB',
          300: '#7E90B1',
          400: '#536B97',
          500: '#2A4A7F',
          600: '#1F3A66',
          700: '#1A2744',
          800: '#121C32',
          900: '#0A1120',
        },
        teal: {
          50: '#E6FFFA',
          100: '#B2F5EA',
          200: '#81E6D9',
          300: '#4FD1C5',
          400: '#14B8A6',
          500: '#0D9488',
          600: '#0A7B72',
          700: '#07655C',
          800: '#054F47',
          900: '#033A32',
        },
        gold: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#D97706',
          600: '#B45309',
          700: '#92400E',
          800: '#78350F',
          900: '#451A03',
        },
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
      },
      spacing: {
        section: '6rem',
        'section-sm': '4rem',
      },
      maxWidth: {
        content: '1200px',
        narrow: '800px',
        wide: '1400px',
      },
      borderRadius: {
        card: '12px',
        button: '8px',
        badge: '6px',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover':
          '0 10px 25px rgba(0,0,0,0.08), 0 4px 10px rgba(0,0,0,0.04)',
        nav: '0 1px 3px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
export default config;

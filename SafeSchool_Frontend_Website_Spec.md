# SafeSchool Foundation — Frontend Website Specification
## Claude Code Development Reference

**Document Purpose:** This is the authoritative specification for building the SafeSchool Foundation website. Claude Code should use this document as the single source of truth for all frontend development decisions.

**Deployment Target:** Railway (https://railway.app)
**Domain:** safeschool.org
**Repository:** GitHub (AGPL-3.0 license)

---

## Table of Contents

1. [Project Setup & Technology Stack](#1-project-setup--technology-stack)
2. [Design System](#2-design-system)
3. [Site Architecture & Routing](#3-site-architecture--routing)
4. [Homepage](#4-homepage)
5. [For Schools Page](#5-for-schools-page)
6. [For Manufacturers Page](#6-for-manufacturers-page)
7. [For Integrators Page](#7-for-integrators-page)
8. [Certified Hardware Directory](#8-certified-hardware-directory)
9. [Certified Installer Directory](#9-certified-installer-directory)
10. [About Page](#10-about-page)
11. [Blog](#11-blog)
12. [Contact & Lead Capture](#12-contact--lead-capture)
13. [Authenticated Pages (Phase 2)](#13-authenticated-pages-phase-2)
14. [Shared Components Library](#14-shared-components-library)
15. [Navigation & Footer](#15-navigation--footer)
16. [SEO & Performance](#16-seo--performance)
17. [Railway Deployment](#17-railway-deployment)
18. [Content Management](#18-content-management)
19. [Analytics & Tracking](#19-analytics--tracking)
20. [Phase 1 vs Phase 2 Scope](#20-phase-1-vs-phase-2-scope)

---

## 1. Project Setup & Technology Stack

### Framework

| Component | Technology | Why |
|---|---|---|
| Framework | **Next.js 14+ (App Router)** | SSR for SEO on marketing pages, React for interactive dashboard, API routes for backend |
| Language | **TypeScript** (strict mode) | Type safety across all components, API contracts enforced at compile time |
| Styling | **Tailwind CSS** | Utility-first, consistent with design tokens, fast iteration |
| UI Components | **shadcn/ui** | Accessible, customizable component primitives built on Radix |
| Animations | **Framer Motion** | Page transitions, scroll-triggered reveals, micro-interactions |
| Forms | **React Hook Form + Zod** | Type-safe form validation matching API schemas |
| State Management | **Zustand** (if needed) | Lightweight, no boilerplate for dashboard state |
| Icons | **Lucide React** | Clean, consistent icon set |
| Email | **Resend** or **SendGrid** | Transactional email for contact forms, notifications |
| CMS | **MDX** (blog posts) | Markdown with React components, version-controlled content |
| Database | **PostgreSQL via Prisma** | Shared with platform API (directories, memberships, blog) |
| Hosting | **Railway** | Single platform for frontend + API + database |
| CI/CD | **GitHub Actions** | Lint, test, build, deploy on push to main |

### Project Initialization

```bash
npx create-next-app@latest safeschool-web --typescript --tailwind --eslint --app --src-dir
cd safeschool-web
npm install framer-motion lucide-react @radix-ui/react-* zod react-hook-form
npx shadcn-ui@latest init
```

### Directory Structure

```
safeschool-web/
├── src/
│   ├── app/                          # Next.js App Router pages
│   │   ├── layout.tsx                # Root layout (nav, footer, fonts, metadata)
│   │   ├── page.tsx                  # Homepage
│   │   ├── schools/
│   │   │   └── page.tsx              # For Schools
│   │   ├── manufacturers/
│   │   │   └── page.tsx              # For Manufacturers
│   │   ├── integrators/
│   │   │   └── page.tsx              # For Integrators
│   │   ├── directory/
│   │   │   ├── hardware/
│   │   │   │   ├── page.tsx          # Hardware directory (searchable)
│   │   │   │   └── [slug]/
│   │   │   │       └── page.tsx      # Individual product page
│   │   │   └── installers/
│   │   │       └── page.tsx          # Installer directory (searchable)
│   │   ├── about/
│   │   │   └── page.tsx              # About / Mission
│   │   ├── blog/
│   │   │   ├── page.tsx              # Blog index
│   │   │   └── [slug]/
│   │   │       └── page.tsx          # Individual blog post
│   │   ├── contact/
│   │   │   └── page.tsx              # Contact / Lead capture
│   │   ├── membership/
│   │   │   └── page.tsx              # Membership application form
│   │   ├── alyssa-law/
│   │   │   └── page.tsx              # Alyssa's Law compliance hub
│   │   ├── developers/
│   │   │   └── page.tsx              # Developer / open source page
│   │   ├── privacy/
│   │   │   └── page.tsx              # Privacy policy
│   │   ├── terms/
│   │   │   └── page.tsx              # Terms of service
│   │   │
│   │   ├── dashboard/                # [PHASE 2] School dashboard
│   │   │   ├── layout.tsx            # Dashboard layout (sidebar nav)
│   │   │   └── page.tsx              # Dashboard home
│   │   ├── portal/                   # [PHASE 2] Manufacturer portal
│   │   │   └── manufacturer/
│   │   │       └── page.tsx
│   │   └── admin/                    # [PHASE 2] Foundation admin
│   │       └── page.tsx
│   │
│   ├── components/                   # Reusable UI components
│   │   ├── layout/
│   │   │   ├── Navbar.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── MobileMenu.tsx
│   │   │   └── PageWrapper.tsx       # Standard page container with transitions
│   │   ├── sections/                 # Page section components
│   │   │   ├── Hero.tsx
│   │   │   ├── ThreeColumnFeature.tsx
│   │   │   ├── StatsCounter.tsx
│   │   │   ├── MemberLogos.tsx
│   │   │   ├── TechPartners.tsx
│   │   │   ├── CTABanner.tsx
│   │   │   ├── TestimonialCard.tsx
│   │   │   ├── PricingTier.tsx
│   │   │   ├── FeatureGrid.tsx
│   │   │   ├── TimelineVertical.tsx
│   │   │   ├── ComplianceMap.tsx
│   │   │   ├── ArchitectureHighlight.tsx
│   │   │   └── ReliabilityCallout.tsx
│   │   ├── directory/
│   │   │   ├── HardwareCard.tsx
│   │   │   ├── InstallerCard.tsx
│   │   │   ├── DirectoryFilter.tsx
│   │   │   └── DirectorySearch.tsx
│   │   ├── blog/
│   │   │   ├── BlogCard.tsx
│   │   │   ├── BlogList.tsx
│   │   │   └── BlogPost.tsx
│   │   ├── forms/
│   │   │   ├── ContactForm.tsx
│   │   │   ├── MembershipApplicationForm.tsx
│   │   │   ├── NewsletterSignup.tsx
│   │   │   └── SchoolInterestForm.tsx
│   │   ├── ui/                       # shadcn/ui components (auto-generated)
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── select.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── ...
│   │   └── common/
│   │       ├── SectionHeading.tsx
│   │       ├── AnimatedCounter.tsx
│   │       ├── ScrollReveal.tsx      # Framer Motion scroll-triggered wrapper
│   │       ├── CertifiedBadge.tsx
│   │       ├── ChartMember Badge.tsx
│   │       └── StatusIndicator.tsx
│   │
│   ├── lib/                          # Utilities and helpers
│   │   ├── utils.ts                  # cn() helper, formatting
│   │   ├── constants.ts              # Site-wide constants
│   │   ├── metadata.ts               # SEO metadata generators
│   │   └── api.ts                    # API client (type-safe, for dashboard phase)
│   │
│   ├── content/                      # Static content
│   │   ├── blog/                     # MDX blog posts
│   │   │   ├── welcome-to-safeschool.mdx
│   │   │   ├── alyssas-law-explained.mdx
│   │   │   └── why-open-source-school-safety.mdx
│   │   └── data/                     # Static data files
│   │       ├── founding-members.ts   # Member data (name, logo, tier, url)
│   │       ├── tech-partners.ts      # Technology partner data
│   │       ├── features.ts           # Feature list data
│   │       ├── compliance-states.ts  # Alyssa's Law state data
│   │       ├── pricing-tiers.ts      # Membership tier data
│   │       └── team.ts              # Board/team member data
│   │
│   ├── hooks/                        # Custom React hooks
│   │   ├── useScrollReveal.ts
│   │   ├── useCountUp.ts
│   │   └── useMediaQuery.ts
│   │
│   └── styles/
│       └── globals.css               # Tailwind imports + custom CSS variables
│
├── public/
│   ├── images/
│   │   ├── logo/                     # SafeSchool logos (SVG, PNG variants)
│   │   ├── members/                  # Founding member logos
│   │   ├── partners/                 # Technology partner logos
│   │   ├── hero/                     # Hero section imagery
│   │   ├── icons/                    # Custom icons (certification badge, etc.)
│   │   └── og/                       # Open Graph images for social sharing
│   ├── favicon.ico
│   ├── robots.txt
│   └── sitemap.xml                   # Auto-generated by Next.js
│
├── prisma/
│   └── schema.prisma                 # Database schema (shared with platform)
│
├── tailwind.config.ts                # Tailwind config with design tokens
├── next.config.mjs                   # Next.js config
├── tsconfig.json
├── railway.toml                      # Railway deployment config
├── Dockerfile                        # Railway uses this for deployment
├── .env.local                        # Local environment variables
├── .env.example                      # Template for required env vars
└── README.md                         # Project documentation
```

---

## 2. Design System

### ⚠️ CRITICAL: Design Philosophy

This website must look **professional, trustworthy, and enterprise-grade**. It represents a life-safety platform that school administrators will evaluate for protecting children. It must NOT look like a startup landing page template, an AI-generated site, or a hobby project.

**Design direction:** Authoritative and warm. Think Stripe's documentation meets a modern healthcare platform. Clean lines, generous whitespace, confident typography, and subtle motion that conveys reliability. Navy and teal convey trust and technology. Gold accents highlight premium partnerships.

### Color Palette

```typescript
// tailwind.config.ts
const colors = {
  // Primary
  navy: {
    50:  '#EEF1F5',
    100: '#D4DAE5',
    200: '#A9B5CB',
    300: '#7E90B1',
    400: '#536B97',
    500: '#2A4A7F',
    600: '#1F3A66',
    700: '#1A2744',   // ← PRIMARY BRAND COLOR
    800: '#121C32',
    900: '#0A1120',
  },
  teal: {
    50:  '#E6FFFA',
    100: '#B2F5EA',
    200: '#81E6D9',
    300: '#4FD1C5',
    400: '#14B8A6',
    500: '#0D9488',   // ← PRIMARY ACCENT COLOR
    600: '#0A7B72',
    700: '#07655C',
    800: '#054F47',
    900: '#033A32',
  },
  gold: {
    50:  '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    300: '#FCD34D',
    400: '#FBBF24',
    500: '#D97706',   // ← PREMIUM/FOUNDING MEMBER ACCENT
    600: '#B45309',
    700: '#92400E',
    800: '#78350F',
    900: '#451A03',
  },
  // Neutrals
  slate: {
    50:  '#F8FAFC',
    100: '#F1F5F9',   // ← CARD/SECTION BACKGROUNDS
    200: '#E2E8F0',
    300: '#CBD5E1',
    400: '#94A3B8',
    500: '#64748B',
    600: '#475569',   // ← SECONDARY TEXT
    700: '#334155',
    800: '#1E293B',   // ← PRIMARY BODY TEXT
    900: '#0F172A',
  },
  // Semantic
  success: '#10B981',
  warning: '#F59E0B',
  danger:  '#EF4444',
  info:    '#3B82F6',
}
```

### Color Usage Rules

| Element | Color | Notes |
|---|---|---|
| Page background | `white` or `slate-50` | Alternate sections between white and slate-50 for visual rhythm |
| Primary headings | `navy-700` | All H1 and section headers |
| Secondary headings | `teal-500` | H2, H3, subsection labels |
| Body text | `slate-800` | Primary readable text |
| Secondary text | `slate-600` | Descriptions, captions, metadata |
| Primary CTA buttons | `teal-500` bg, `white` text | "Get Started", "Sign Up", "Join" |
| Secondary CTA buttons | `navy-700` bg, `white` text | "Learn More", "View Directory" |
| Outline buttons | `navy-700` border, `navy-700` text | Tertiary actions |
| Links | `teal-600` | Underline on hover |
| Founding member highlights | `gold-500` accents | Badge borders, tier labels, special callouts |
| Charter member badge | `gold-500` bg | Sicunet gets a special gold badge |
| Navigation bar | `white` bg with subtle bottom shadow | Sticky on scroll |
| Footer | `navy-700` bg | Full-width dark footer |
| Card borders | `slate-200` | Subtle, 1px |
| Card hover | Subtle `teal-500` border or shadow lift | Indicates interactivity |
| Error states | `danger` | Form validation errors |
| Success states | `success` or `teal-500` | Form submissions, certifications |

### Typography

```css
/* globals.css */
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
```

| Element | Font | Weight | Size | Line Height | Tracking |
|---|---|---|---|---|---|
| Display (hero) | Plus Jakarta Sans | 800 (ExtraBold) | 56-72px | 1.1 | -0.02em |
| H1 | Plus Jakarta Sans | 700 (Bold) | 40-48px | 1.2 | -0.01em |
| H2 | Plus Jakarta Sans | 700 (Bold) | 28-36px | 1.25 | -0.01em |
| H3 | Plus Jakarta Sans | 600 (SemiBold) | 22-26px | 1.3 | 0 |
| H4 | Plus Jakarta Sans | 600 (SemiBold) | 18-20px | 1.4 | 0 |
| Body | Plus Jakarta Sans | 400 (Regular) | 16-18px | 1.6 | 0 |
| Body small | Plus Jakarta Sans | 400 (Regular) | 14px | 1.5 | 0 |
| Button | Plus Jakarta Sans | 600 (SemiBold) | 15-16px | 1 | 0.01em |
| Nav links | Plus Jakarta Sans | 500 (Medium) | 15px | 1 | 0 |
| Code/mono | JetBrains Mono | 400 | 14px | 1.6 | 0 |
| Caption | Plus Jakarta Sans | 500 (Medium) | 12-13px | 1.4 | 0.05em |
| Overline labels | Plus Jakarta Sans | 600 (SemiBold) | 12px | 1 | 0.08em (uppercase) |

### Tailwind Config

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // paste full color palette from above
      },
      spacing: {
        'section': '6rem',     // Vertical padding between page sections
        'section-sm': '4rem',  // Smaller section spacing on mobile
      },
      maxWidth: {
        'content': '1200px',   // Max content width
        'narrow': '800px',     // Blog posts, text-heavy pages
        'wide': '1400px',      // Full-bleed sections
      },
      borderRadius: {
        'card': '12px',
        'button': '8px',
        'badge': '6px',
        'pill': '9999px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 10px 25px rgba(0,0,0,0.08), 0 4px 10px rgba(0,0,0,0.04)',
        'nav': '0 1px 3px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),  // For blog post prose styling
  ],
}
export default config
```

### Spacing System

| Context | Spacing |
|---|---|
| Between page sections | 96px (6rem) desktop / 64px (4rem) mobile |
| Between section heading and content | 40px (2.5rem) |
| Between cards in a grid | 24px (1.5rem) |
| Card internal padding | 24-32px |
| Button padding | 12px vertical, 24px horizontal |
| Nav height | 72px |
| Footer top padding | 64px |
| Page horizontal padding | 24px mobile, 32px tablet, 0 desktop (centered max-width) |

### Motion & Animation

Use Framer Motion for all animation. Every section on every page should fade in and slide up slightly on scroll. This creates a polished, deliberate feel.

```typescript
// components/common/ScrollReveal.tsx
'use client'
import { motion } from 'framer-motion'

export function ScrollReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
```

**Animation rules:**
- Page sections: Fade in + 24px upward slide, staggered by 0.1s between children
- Stats counters: Count up animation when scrolled into view
- Cards: Subtle shadow lift on hover (0.2s ease)
- CTA buttons: Scale to 1.02 on hover, subtle shadow increase
- Navigation: Slide down on page load, add shadow on scroll
- Page transitions: Crossfade between pages (0.3s)
- Member logos: Subtle continuous scroll marquee (optional)
- Do NOT animate: body text, links, form fields, navigation links

### Imagery Direction

- Use abstract geometric patterns or mesh gradients for hero backgrounds — NOT stock photos of schools or children
- Subtle grid/mesh pattern overlay on navy sections to reinforce the "network" concept
- SVG illustrations for feature explanations (clean, flat, matching brand colors)
- Actual member logos (not placeholders) once collected
- Architecture diagrams rendered as clean SVGs or React components
- Map visualizations for the Alyssa's Law compliance section

---

## 3. Site Architecture & Routing

### URL Structure

```
safeschool.org/                       # Homepage
safeschool.org/schools                # For Schools landing page
safeschool.org/manufacturers          # For Manufacturers landing page
safeschool.org/integrators            # For Integrators landing page
safeschool.org/directory/hardware     # Certified Hardware Directory
safeschool.org/directory/hardware/[slug]  # Individual product page
safeschool.org/directory/installers   # Certified Installer Directory
safeschool.org/about                  # About / Mission
safeschool.org/blog                   # Blog index
safeschool.org/blog/[slug]            # Individual blog post
safeschool.org/contact                # Contact form
safeschool.org/membership             # Membership application
safeschool.org/alyssa-law             # Alyssa's Law compliance hub
safeschool.org/developers             # Open source / developer page
safeschool.org/privacy                # Privacy policy
safeschool.org/terms                  # Terms of service

# Phase 2 (authenticated)
safeschool.org/dashboard              # School dashboard
safeschool.org/portal/manufacturer    # Manufacturer portal
safeschool.org/admin                  # Foundation admin
```

### Navigation Structure

**Primary Nav (visible on all pages):**
```
[SafeSchool Logo]   Schools   Manufacturers   Integrators   Directory ▾   About   Blog   [Get Started →]
                                                            ├── Hardware
                                                            └── Installers
```

**Mobile Nav (hamburger menu):**
All links stacked vertically with "Get Started" as prominent CTA at bottom.

---

## 4. Homepage

**Route:** `/`
**Purpose:** First impression. Must communicate the mission, build trust, and route visitors to the right path within 10 seconds.

### Section 1: Hero

**Layout:** Full-width, navy-700 background with subtle mesh/grid pattern overlay. Centered content.

```
[Overline: THE OPEN STANDARD FOR SCHOOL SAFETY]

Every School Protected.
Every Manufacturer Welcome.
Zero Cost.

SafeSchool is a free, open source platform that unifies school safety
technology from any hardware manufacturer into one universal standard.

[I'm a School (teal CTA)]    [I'm a Manufacturer (white outline CTA)]

                Sponsored by Our Founding Members
          [Sicunet logo ★Charter]  [future logos...]
```

**Technical notes:**
- Navy gradient background: `bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900`
- Subtle animated mesh/grid SVG pattern with 5% opacity overlay
- Headline: Display font, white, 56-72px
- Subheadline: slate-300, 18-20px, max-width 640px centered
- Founding member logos: white/light versions, 40-50px height, horizontal row
- Sicunet logo gets a small gold "★ Charter" badge
- Scroll indicator at bottom (animated chevron)

### Section 2: The Problem

**Layout:** White background. Two columns on desktop, stacked on mobile.

```
                    The Problem

Schools face a fragmented landscape    │   [SVG illustration: disconnected
of proprietary safety systems that     │    puzzle pieces / siloed systems]
don't talk to each other. Hardware     │
vendors are locked out of the market   │
because building complete software     │
stacks costs millions. And schools     │
pay the price — stuck with expensive,  │
inflexible systems from a single       │
vendor.                                │

    ✕ Proprietary silos that don't communicate
    ✕ Vendor lock-in with no exit strategy
    ✕ Small manufacturers shut out
    ✕ Schools overpaying for inflexible systems
```

### Section 3: The Solution

**Layout:** Slate-50 background. Centered content.

```
                    The Solution

SafeSchool creates a universal standard — like USB for school safety.
Any certified hardware works with the platform. Schools choose the best
hardware for their needs. Manufacturers compete on quality, not lock-in.

    [Three-column feature grid]

    🏫 For Schools              🏭 For Manufacturers         🔧 For Integrators
    ────────────                ─────────────────           ─────────────────
    100% free platform          Market access to            New revenue stream
    Any certified hardware      thousands of schools        from installation
    Vendor neutral              No software to build        and configuration
    Alyssa's Law compliant      Certification included      Training program
    Cloud hosted, maintained    Directory listing           Certified installer
    for you                     Brand visibility            directory listing

    [View All Features →]
```

### Section 4: How It Works

**Layout:** White background. Numbered steps with connecting line.

```
                  How It Works

    ① Schools sign up for free
       Get the complete SafeSchool platform at zero cost.
       Cloud hosted. Always updated. Always free.

          │

    ② Choose certified hardware
       Browse the hardware directory. Pick readers, panic
       buttons, cameras from any certified manufacturer.

          │

    ③ Hire a certified installer
       Find a trained, certified installer in your region.
       They configure everything.

          │

    ④ You're protected
       Unified dashboard. Real-time alerts. Location tracking.
       Alyssa's Law compliant. Peace of mind.
```

### Section 5: Stats Counter

**Layout:** Teal-500 background, white text. Full-width band.

```
    [Animated counter]     [Animated counter]     [Animated counter]     [Animated counter]
     Schools Protected      Manufacturers          States with             Uptime Target
                            Certified              Alyssa's Law
         0+                    1                      9+                    99.9%
```

**Note:** These start small and will grow. Use `0+` for schools initially. The counter animates when scrolled into view using `useCountUp` hook.

### Section 6: Architecture & Engineering

**Layout:** White background. This section builds trust with technical decision-makers.

```
                Enterprise-Grade Engineering

SafeSchool isn't a weekend project. It's a modular, framework-centric
platform built to life-safety standards.

    [Four cards in a row]

    🧱 Modular Architecture          📡 Fully Documented APIs
    Every service independently       OpenAPI 3.0 spec. Versioned
    deployable and testable.          endpoints. Error catalogs.
    Plugin system for extensions.     SDK-ready for integrations.

    🔍 Troubleshootable by Design    🛡️ Reliability First
    Correlation IDs trace every       99.9% uptime target.
    request end-to-end. Structured    Per-module health checks.
    logging. Per-module debug mode.   Automated regression testing.

    [View Technical Documentation →]     [View on GitHub →]
```

### Section 7: Premium Integrations

**Layout:** Slate-50 background. Two cards side by side.

```
                Premium Integrations

Enhance SafeSchool with powerful add-ons from our ecosystem.

    ┌──────────────────────────────┐    ┌──────────────────────────────┐
    │  🪪 BadgeKiosk               │    │  🧠 AccessIQ                 │
    │  Visitor Management          │    │  AI-Powered Analytics        │
    │                              │    │                              │
    │  Streamlined visitor          │    │  Detect anomalous access     │
    │  check-in, badge printing,   │    │  patterns. AI-powered alerts │
    │  watchlist screening, and    │    │  when credentials are used   │
    │  emergency lockdown          │    │  outside normal behavior.    │
    │  notifications.              │    │  Real-time threat detection. │
    │                              │    │                              │
    │  Starting at $200/month      │    │  Starting at $300/month      │
    │  [Learn More →]              │    │  [Learn More →]              │
    └──────────────────────────────┘    └──────────────────────────────┘
```

### Section 8: Alyssa's Law Map

**Layout:** White background. Interactive US map showing states with Alyssa's Law.

```
                Alyssa's Law Compliance Built In

9+ states now require silent panic alarms in schools. SafeSchool
meets every requirement, so you don't have to figure it out alone.

    [Interactive US map with highlighted states]
    
    NJ ✓  FL ✓  NY ✓  TX ✓  OK ✓  TN ✓  VA ✓  AZ ✓  NC ✓

    [View Compliance Details →]
```

**Technical:** Render a simple SVG US map with highlighted states. On hover, show state name and key requirement. Link to `/alyssa-law` for details.

### Section 9: Open Source

**Layout:** Slate-50 background.

```
                Open Source & Community Driven

SafeSchool is open source under the AGPL license. Inspect the code.
Contribute improvements. Trust what protects your school.

    [GitHub icon]  github.com/safeschool/safeschool
    
    ⭐ [star count]    🔀 [fork count]    👥 [contributor count]

    [View on GitHub →]    [Contributing Guide →]
```

### Section 10: CTA Banner

**Layout:** Navy-700 full-width band.

```
    Ready to protect your school?                    Ready to join the ecosystem?
    [Get Started — It's Free (teal CTA)]             [Become a Member (gold outline CTA)]
```

### Section 11: Footer

See [Section 15: Navigation & Footer](#15-navigation--footer).

---

## 5. For Schools Page

**Route:** `/schools`
**Purpose:** Convince school administrators that SafeSchool is free, reliable, and compliant.

### Sections:

1. **Hero:** "Your School Deserves the Best Safety Technology. For Free." Navy background.

2. **What You Get:** Feature grid showing everything included at zero cost:
   - Unified access control dashboard
   - Emergency panic alert system with location tracking
   - BLE mesh indoor positioning
   - Visitor check-in (basic)
   - Real-time notifications (email, SMS, push)
   - Multi-site management for districts
   - Certified hardware compatibility
   - Alyssa's Law compliance reporting
   - 911/PSAP integration
   - Cloud hosted — no servers to manage

3. **How It's Free:** Explain the model — manufacturer memberships fund the platform. "Every school that uses SafeSchool sees our founding members' logos. That visibility is why they sponsor the platform."

4. **Certified Hardware Directory CTA:** "Choose from hardware certified to work perfectly with SafeSchool." Link to `/directory/hardware`.

5. **Certified Installer Directory CTA:** "Find a trained installer in your area." Link to `/directory/installers`.

6. **Support Options:**
   - Community (free): Forums, documentation, GitHub
   - Standard ($TBD/month): Email support, 24-hour SLA
   - Priority ($TBD/month): Phone support, 4-hour SLA

7. **Alyssa's Law Section:** Brief overview with link to `/alyssa-law`.

8. **Testimonial placeholder:** Space for future school testimonials.

9. **CTA:** "Sign Up for SafeSchool — It's Free" → leads to contact/interest form.

---

## 6. For Manufacturers Page

**Route:** `/manufacturers`
**Purpose:** Convince hardware manufacturers to join as founding members. This is a revenue-generating page.

### Sections:

1. **Hero:** "Get Your Hardware Into Every School in America." Navy background.

2. **The Opportunity:** Schools adopting SafeSchool choose from the certified hardware directory. Your hardware listed = your hardware sold. No software to build. No platform to maintain. Just make great hardware and get certified.

3. **Current Members:** "Join These Companies" — Sicunet logo with Charter badge, space for future members.

4. **Membership Tiers:** Three pricing cards side by side.

```
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
    │   SILVER         │   │   GOLD ★         │   │   PLATINUM       │
    │   $5,000/year    │   │   $15,000/year   │   │   $25,000/year   │
    │                  │   │   Most Popular    │   │                  │
    │ 1 certification  │   │ 3 certifications │   │ Unlimited certs  │
    │ Directory listing│   │ Directory listing│   │ Top placement    │
    │ Logo on website  │   │ Logo on website  │   │ Dashboard logo   │
    │ Community support│   │ Roadmap input    │   │ Advisory board   │
    │                  │   │ Early API access │   │ Priority support │
    │                  │   │ Standard support │   │ Early API access │
    │                  │   │                  │   │ Conference slot   │
    │                  │   │                  │   │                  │
    │ [Apply →]        │   │ [Apply →]        │   │ [Apply →]        │
    └─────────────────┘   └─────────────────┘   └─────────────────┘
```

Gold should be visually highlighted as "Most Popular" with a teal accent border.

5. **Certification Process:** Visual timeline showing the 7-step process:
   - Submit hardware → Integration testing → Functional testing → Security review → Certification report → Directory listing → Annual recertification

6. **What Certification Tests:** Brief description of automated testing powered by the QA bot system. "Your hardware is tested against hundreds of scenarios automatically."

7. **CTA:** "Apply for Founding Membership" → link to `/membership`.

---

## 7. For Integrators Page

**Route:** `/integrators`
**Purpose:** Recruit integrators to the certified installer program.

### Sections:

1. **Hero:** "Build Your Business on School Safety." Navy background.

2. **The Opportunity:** Schools using SafeSchool need certified installers. Get trained, get certified, get listed in the directory where schools find you.

3. **Training Program:** Overview of regional training, online courses, hands-on practical exam.

4. **Benefits:**
   - Listed in the certified installer directory (schools find you)
   - "SafeSchool Certified Installer" credential
   - Access to certified hardware at installer pricing (through manufacturers)
   - Ongoing technical support
   - Business referrals from SafeSchool

5. **CTA:** "Get Certified" → contact form.

---

## 8. Certified Hardware Directory

**Route:** `/directory/hardware`
**Purpose:** Searchable catalog of all SafeSchool-certified hardware.

### Features:

- **Search bar** at top (full-text search across product names, manufacturers, descriptions)
- **Filter sidebar:**
  - Product type: Readers, Panels, Panic Buttons, Cameras, Intercoms, Gateways
  - Manufacturer: Checkbox list
  - Features: BLE, PoE, Outdoor rated, Wireless, etc.
  - Sort by: Newest, Manufacturer A-Z, Most Popular
- **Product cards** in a grid (3 columns desktop, 2 tablet, 1 mobile):

```
┌────────────────────────────────────┐
│  [Product image placeholder]        │
│                                    │
│  Sicunet SR-200 Smart Reader   ★ Charter Member
│  Manufacturer: Sicunet
│  Type: Access Control Reader
│  Features: BLE, PoE, OSDP
│
│  ✓ SafeSchool Certified
│  Certified: March 2026
│
│  [View Details →]
└────────────────────────────────────┘
```

- **Individual product page** (`/directory/hardware/[slug]`):
  - Full product details
  - Certification date and report summary
  - Compatibility notes
  - Manufacturer information and link
  - "Works with SafeSchool" badge graphic manufacturer can use

### Data Source:
Phase 1: Static data in `content/data/` files.
Phase 2: Database-driven from Prisma/PostgreSQL.

---

## 9. Certified Installer Directory

**Route:** `/directory/installers`
**Purpose:** Help schools find certified installers in their area.

### Features:

- **Search by location:** Zip code or state
- **Filter:** Certification level, specialization
- **Installer cards:**

```
┌────────────────────────────────────┐
│  ABC Security Solutions
│  📍 Providence, RI
│  Certifications: SafeSchool Certified Installer
│  Specialization: K-12 Schools
│  
│  [Contact →]
└────────────────────────────────────┘
```

### Data Source:
Phase 1: Static data or simple form submission.
Phase 2: Database-driven with installer self-service portal.

---

## 10. About Page

**Route:** `/about`
**Purpose:** Tell the SafeSchool story, build trust, show transparency.

### Sections:

1. **Mission Statement:** "SafeSchool exists to ensure every school in America has access to the best safety technology, regardless of budget."

2. **The Story:** How a 20-year QA veteran saw the problem from inside the access control industry and decided to fix it. Built with AI-assisted development. Open source from day one.

3. **Board of Directors / Team:** Photos (or placeholder silhouettes), names, roles, brief bios.

4. **Transparency:** "We publish annual reports showing exactly how membership fees are used. Every dollar goes to platform development, hosting, and the certification program."

5. **Open Source Philosophy:** Why AGPL. Why open source matters for school safety. Link to GitHub.

6. **Contact CTA:** partners@safeschool.org

---

## 11. Blog

**Route:** `/blog` and `/blog/[slug]`
**Purpose:** SEO content, thought leadership, announcements.

### Blog Index:
- Grid of blog cards (2 columns desktop)
- Each card: title, excerpt, date, category tag, read time
- Category filter: Announcements, School Safety, Alyssa's Law, Technical, Industry News

### Blog Post:
- MDX rendering with `@tailwindcss/typography` prose styling
- Table of contents sidebar (desktop)
- Author info
- Related posts at bottom
- Social sharing buttons
- Newsletter signup at bottom

### Initial Posts to Write:
1. "Welcome to SafeSchool: The Open Standard for School Safety"
2. "What Is Alyssa's Law and What Does It Mean for Your School?"
3. "Why Open Source Matters for School Safety Technology"
4. "Introducing Our Charter Member: Sicunet"
5. "The Technology Behind SafeSchool: Built with AI"

---

## 12. Contact & Lead Capture

**Route:** `/contact` and `/membership`

### Contact Form (`/contact`):
```
I am a:  [ ] School Administrator  [ ] Manufacturer  [ ] Integrator  [ ] Other

Name: _______________
Email: _______________
Organization: _______________
Message: _______________

[Send Message →]
```

Submissions go to: partners@safeschool.org (via Resend/SendGrid API route).

### Membership Application (`/membership`):
More detailed form for manufacturer membership applications.
```
Company Name: _______________
Contact Name: _______________
Title: _______________
Email: _______________
Phone: _______________
Website: _______________
Product Categories: [ ] Readers [ ] Panels [ ] Panic Buttons [ ] Cameras [ ] Intercoms [ ] Gateways [ ] Other
Interested Tier: [ ] Platinum [ ] Gold [ ] Silver [ ] Not Sure
How did you hear about us?: _______________
Additional Notes: _______________

[Submit Application →]
```

### School Interest Form:
Simplified form for schools.
```
School/District Name: _______________
Contact Name: _______________
Title: _______________
Email: _______________
State: _______________
Number of Buildings: _______________
Current Safety System (if any): _______________
Timeline: [ ] Immediate [ ] 3 months [ ] 6 months [ ] Just exploring

[Sign Up for Updates →]
```

All forms: Zod validation, React Hook Form, success/error states, API route handler.

---

## 13. Authenticated Pages (Phase 2)

**NOT in Phase 1 scope.** Create placeholder pages with "Coming Soon" messaging.

### School Dashboard (`/dashboard`)
- Building overview with device status
- Recent access events
- Emergency alert controls
- Visitor check-in
- Settings

### Manufacturer Portal (`/portal/manufacturer`)
- Certification status
- Test results
- Directory listing management
- API credentials

### Admin Dashboard (`/admin`)
- Membership management
- Certification workflow
- Platform analytics
- Support tickets

**For Phase 1:** These routes should exist but show a "Coming Q2 2026" page with an email signup to be notified.

---

## 14. Shared Components Library

Every reusable component must be:
- TypeScript with explicit prop interfaces
- Fully accessible (keyboard navigation, ARIA labels, screen reader support)
- Responsive (mobile-first)
- Documented with JSDoc comments
- Wrapped in ScrollReveal for animation where appropriate

### Key Components to Build:

```typescript
// SectionHeading — Used on every page for section titles
interface SectionHeadingProps {
  overline?: string;      // Small uppercase label above heading
  title: string;          // Main heading text
  subtitle?: string;      // Description text below heading
  align?: 'left' | 'center';
  theme?: 'light' | 'dark'; // Dark for navy backgrounds
}

// ThreeColumnFeature — Schools/Manufacturers/Integrators grid
interface ThreeColumnFeatureProps {
  columns: {
    icon: React.ReactNode;
    title: string;
    description: string;
    features: string[];
    cta?: { label: string; href: string };
  }[];
}

// PricingTier — Membership pricing cards
interface PricingTierProps {
  tiers: {
    name: string;
    price: string;
    period: string;
    highlighted?: boolean;
    badge?: string;
    features: string[];
    cta: { label: string; href: string };
  }[];
}

// MemberLogos — Founding member logo strip
interface MemberLogosProps {
  title?: string;
  members: {
    name: string;
    logo: string; // path to logo image
    tier: 'charter' | 'platinum' | 'gold' | 'silver';
    url?: string;
  }[];
  theme?: 'light' | 'dark';
}

// TechPartners — "Built with" technology partner strip
interface TechPartnersProps {
  partners: {
    name: string;
    logo: string;
    url: string;
  }[];
}

// StatsCounter — Animated number counter band
interface StatsCounterProps {
  stats: {
    value: number;
    suffix?: string;  // "+", "%"
    label: string;
  }[];
  theme?: 'teal' | 'navy';
}

// CTABanner — Full-width call-to-action band
interface CTABannerProps {
  headline: string;
  description?: string;
  primaryCTA: { label: string; href: string };
  secondaryCTA?: { label: string; href: string };
  theme?: 'navy' | 'teal';
}

// FeatureGrid — Grid of feature cards with icons
interface FeatureGridProps {
  features: {
    icon: React.ReactNode;
    title: string;
    description: string;
  }[];
  columns?: 2 | 3 | 4;
}

// TimelineVertical — Numbered steps with connecting line
interface TimelineVerticalProps {
  steps: {
    number: number;
    title: string;
    description: string;
  }[];
}

// CertifiedBadge — "SafeSchool Certified" badge
interface CertifiedBadgeProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'charter';
}

// ComplianceMap — US map with highlighted Alyssa's Law states
interface ComplianceMapProps {
  states: {
    code: string;
    name: string;
    status: 'enacted' | 'pending' | 'none';
    details?: string;
  }[];
}
```

---

## 15. Navigation & Footer

### Navbar

```typescript
// Sticky, white background, subtle shadow on scroll
// Height: 72px
// Logo on left, links center, CTA right

// Desktop:
[Logo]   Schools   Manufacturers   Integrators   Directory ▾   About   Blog   [Get Started →]

// Mobile:
[Logo]                                                                         [☰ Hamburger]
```

- Logo links to `/`
- "Directory" is a dropdown: Hardware, Installers
- "Get Started" is teal CTA button → `/schools` (or `/contact`)
- On scroll past hero: add `shadow-nav` class
- Mobile: full-screen overlay menu with staggered animation

### Footer

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  [Navy-700 background, full width]                                          │
│                                                                              │
│  ┌─── Column 1 ───┐  ┌─── Column 2 ───┐  ┌─── Column 3 ───┐  ┌── Col 4 ──┐│
│  │ SafeSchool       │  │ Platform        │  │ Community       │  │ Legal     ││
│  │                  │  │                 │  │                 │  │           ││
│  │ The open standard│  │ For Schools     │  │ GitHub          │  │ Privacy   ││
│  │ for school safety│  │ For Manufacturers│ │ Documentation   │  │ Terms     ││
│  │ technology.      │  │ For Integrators │  │ Blog            │  │ Contact   ││
│  │                  │  │ Hardware Dir    │  │ Contributing    │  │           ││
│  │ partners@        │  │ Installer Dir   │  │                 │  │           ││
│  │ safeschool.org   │  │ Alyssa's Law    │  │                 │  │           ││
│  └──────────────────┘  └─────────────────┘  └─────────────────┘  └───────────┘│
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Sponsored by Our Founding Members                                          │
│  [Sicunet logo ★Charter]  [future member logos...]                          │
│                                                                              │
│  Built with                                                                  │
│  [Claude Code logo]  [Railway logo]  [GitHub logo]                          │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  © 2026 SafeSchool Foundation. Open source under AGPL.   [GitHub icon]      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Footer text: slate-400 on navy-700
- Links: slate-300, hover → white
- Member logos: White/light versions, 30-40px height
- Tech partner logos: White/light versions, 24-30px height
- Two distinct rows with labels to differentiate hardware sponsors from tech partners

---

## 16. SEO & Performance

### Meta Tags (per page):

```typescript
// lib/metadata.ts
export function generateMetadata(page: string) {
  const base = {
    siteName: 'SafeSchool Foundation',
    url: 'https://safeschool.org',
    image: '/images/og/default.png',
  }
  
  const pages = {
    home: {
      title: 'SafeSchool — The Open Standard for School Safety Technology',
      description: 'Free, open source school safety platform. Unify access control, panic buttons, and cameras from any manufacturer. 100% free for schools.',
    },
    schools: {
      title: 'Free School Safety Platform | SafeSchool',
      description: 'Get the complete SafeSchool platform at zero cost. Access control, panic alerts, location tracking, and Alyssa\'s Law compliance. Free forever.',
    },
    manufacturers: {
      title: 'Become a SafeSchool Founding Member | Manufacturers',
      description: 'Get your hardware into every school in America. Join the SafeSchool ecosystem as a founding member. Certification included.',
    },
    // ... etc
  }
}
```

### Performance Targets:

| Metric | Target |
|---|---|
| Lighthouse Performance | >95 |
| Lighthouse Accessibility | 100 |
| LCP (Largest Contentful Paint) | < 2.5s |
| FID (First Input Delay) | < 100ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| Time to Interactive | < 3s |

### Implementation:

- Use Next.js `Image` component for all images (automatic optimization)
- Lazy load below-the-fold sections
- Preload fonts (Plus Jakarta Sans)
- Static generation (SSG) for all marketing pages
- ISR (Incremental Static Regeneration) for directories and blog
- Minimal JavaScript on marketing pages (SSR + minimal client JS)

---

## 17. Railway Deployment

### railway.toml

```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

[service]
internalPort = 3000
```

### Environment Variables

```env
# Required
NODE_ENV=production
NEXT_PUBLIC_SITE_URL=https://safeschool.org
DATABASE_URL=postgresql://...           # Railway PostgreSQL

# Email (contact forms)
RESEND_API_KEY=...
CONTACT_EMAIL=partners@safeschool.org

# Analytics (Phase 1: optional)
NEXT_PUBLIC_GA_ID=...                   # Google Analytics
NEXT_PUBLIC_POSTHOG_KEY=...             # PostHog (open source analytics)

# Phase 2
NEXTAUTH_URL=https://safeschool.org
NEXTAUTH_SECRET=...
```

### Custom Domain Setup

1. Add custom domain `safeschool.org` in Railway dashboard
2. Configure DNS: CNAME record pointing to Railway
3. Railway handles SSL automatically
4. Set up `www.safeschool.org` redirect to `safeschool.org`

---

## 18. Content Management

### Phase 1: File-Based Content

All content lives in the repository as TypeScript data files and MDX:

```typescript
// content/data/founding-members.ts
export const foundingMembers = [
  {
    name: 'Sicunet',
    slug: 'sicunet',
    tier: 'charter' as const,
    logo: '/images/members/sicunet.svg',
    logoLight: '/images/members/sicunet-light.svg', // For dark backgrounds
    url: 'https://sicunet.com',
    description: 'Access control hardware manufacturer. Charter Founding Member.',
    products: ['SR-200 Smart Reader', 'SP-100 Smart Panel'],
    joinedDate: '2026-02',
  },
  // Future members added here
]

// content/data/pricing-tiers.ts
export const pricingTiers = [
  {
    name: 'Silver',
    price: '$5,000',
    period: '/year',
    highlighted: false,
    features: [
      '1 product certification included',
      'Listed in hardware directory',
      'Logo on website',
      'Community integration support',
    ],
  },
  {
    name: 'Gold',
    price: '$15,000',
    period: '/year',
    highlighted: true,
    badge: 'Most Popular',
    features: [
      'Up to 3 product certifications',
      'Listed in hardware directory',
      'Logo on website',
      'Roadmap input',
      'Early API access',
      'Standard integration support',
    ],
  },
  {
    name: 'Platinum',
    price: '$25,000',
    period: '/year',
    highlighted: false,
    features: [
      'Unlimited product certifications',
      'Top placement in directory',
      'Logo on dashboard',
      'Advisory board seat',
      'Priority integration support',
      'Early API access',
      'Conference speaking opportunity',
    ],
  },
]

// content/data/compliance-states.ts
export const alyssaLawStates = [
  { code: 'NJ', name: 'New Jersey', status: 'enacted', year: 2019, details: 'First state to enact. Requires silent panic alarms in all public schools.' },
  { code: 'FL', name: 'Florida', status: 'enacted', year: 2020, details: 'Alyssa\'s Law passed as part of school safety legislation.' },
  { code: 'NY', name: 'New York', status: 'enacted', year: 2022, details: 'Requires silent panic alarms connected to 911.' },
  { code: 'TX', name: 'Texas', status: 'enacted', year: 2023, details: 'School safety requirements including panic systems.' },
  { code: 'OK', name: 'Oklahoma', status: 'enacted', year: 2023, details: 'Silent alarm requirements for K-12 schools.' },
  { code: 'TN', name: 'Tennessee', status: 'enacted', year: 2023, details: 'Panic alarm mandate for public schools.' },
  { code: 'VA', name: 'Virginia', status: 'enacted', year: 2024, details: 'School safety panic alarm requirements.' },
  { code: 'AZ', name: 'Arizona', status: 'enacted', year: 2024, details: 'Silent panic alarm mandate.' },
  { code: 'NC', name: 'North Carolina', status: 'enacted', year: 2024, details: 'School safety technology requirements.' },
]

// content/data/tech-partners.ts
export const techPartners = [
  { name: 'Claude Code', logo: '/images/partners/claude-code.svg', url: 'https://anthropic.com' },
  { name: 'Railway', logo: '/images/partners/railway.svg', url: 'https://railway.app' },
  { name: 'GitHub', logo: '/images/partners/github.svg', url: 'https://github.com' },
]
```

### Phase 2: Database-Driven

Migrate directory data, member data, and blog posts to PostgreSQL via Prisma when the platform API is ready. The frontend components don't change — only the data source switches from static files to API calls.

---

## 19. Analytics & Tracking

### Phase 1: Lightweight

- **PostHog** (open source, self-hostable) for page views, form submissions, CTA clicks
- **Google Search Console** for SEO monitoring
- No invasive tracking — respect school administrator privacy

### Key Events to Track:

| Event | Trigger |
|---|---|
| `page_view` | Every page load |
| `cta_click` | Any CTA button click (with label and destination) |
| `form_submit` | Contact, membership, school interest forms (success only) |
| `directory_search` | Search or filter in hardware/installer directory |
| `directory_click` | Click on a product or installer card |
| `blog_read` | Blog post viewed (with slug and read time) |
| `github_click` | Click to GitHub repo |
| `external_link` | Click to member/partner external site |

---

## 20. Phase 1 vs Phase 2 Scope

### Phase 1: ISC West Ready (Target: March 15, 2026)

**Must have — ship before ISC West:**

- [ ] Homepage (all 11 sections)
- [ ] For Schools page
- [ ] For Manufacturers page
- [ ] For Integrators page
- [ ] About page
- [ ] Contact form (working, sends email)
- [ ] Membership application form (working, sends email)
- [ ] Navigation and footer
- [ ] Mobile responsive
- [ ] Deployed on Railway with custom domain
- [ ] SSL configured
- [ ] Basic SEO (meta tags, Open Graph, sitemap)
- [ ] Founding member logos (Sicunet at minimum)
- [ ] "Built with" tech partner section

**Nice to have for Phase 1:**

- [ ] Blog with 2-3 initial posts
- [ ] Certified Hardware Directory (static data, Sicunet products)
- [ ] Certified Installer Directory (placeholder)
- [ ] Alyssa's Law compliance page
- [ ] Developers / open source page
- [ ] PostHog analytics
- [ ] Animated stats counters
- [ ] US compliance map

### Phase 2: Platform Beta (Target: Q2 2026)

- [ ] Authentication (NextAuth.js)
- [ ] School Dashboard
- [ ] Manufacturer Portal
- [ ] Admin Dashboard
- [ ] Database-driven directories
- [ ] Blog CMS (MDX → database)
- [ ] School interest form → account creation flow
- [ ] API integration with platform backend services
- [ ] Real-time WebSocket connections for dashboard

### Phase 3: Scale (Target: Q3-Q4 2026)

- [ ] Multi-site district dashboard
- [ ] Emergency response controls
- [ ] Live device status
- [ ] BadgeKiosk integration
- [ ] AccessIQ integration
- [ ] Installer self-service portal
- [ ] Advanced analytics and reporting

---

## Appendix A: Quick Reference for Claude Code

### Getting Started
```bash
# Clone and install
git clone https://github.com/safeschool/safeschool-web.git
cd safeschool-web
npm install

# Run development server
npm run dev
# → http://localhost:3000

# Build for production
npm run build

# Deploy (Railway auto-deploys on push to main)
git push origin main
```

### Key Files to Create First
1. `tailwind.config.ts` — Design tokens (colors, fonts, spacing)
2. `src/app/layout.tsx` — Root layout with fonts, nav, footer
3. `src/components/layout/Navbar.tsx` — Navigation
4. `src/components/layout/Footer.tsx` — Footer
5. `src/components/common/ScrollReveal.tsx` — Animation wrapper
6. `src/components/sections/SectionHeading.tsx` — Reusable heading
7. `src/app/page.tsx` — Homepage (most complex page, build first)
8. `src/content/data/` — All static data files

### Design Tokens Quick Reference
- **Navy primary:** `#1A2744` → `navy-700`
- **Teal accent:** `#0D9488` → `teal-500`
- **Gold premium:** `#D97706` → `gold-500`
- **Body text:** `#1E293B` → `slate-800`
- **Secondary text:** `#475569` → `slate-600`
- **Card backgrounds:** `#F1F5F9` → `slate-100`
- **Font:** Plus Jakarta Sans (400, 500, 600, 700, 800)
- **Code font:** JetBrains Mono (400, 500)
- **Max content width:** 1200px
- **Section spacing:** 6rem (96px) desktop, 4rem (64px) mobile

### The Non-Negotiable Rule
This website must look like it was built by a well-funded organization that takes school safety seriously. Not a startup template. Not a hackathon project. Not generic AI output. Professional, trustworthy, and beautiful. Every school administrator who sees this site should think: "These people know what they're doing."

---

*This document is the authoritative frontend specification for the SafeSchool website. Claude Code should follow this spec exactly for design decisions, component architecture, content structure, and deployment configuration. When in doubt: build it modular, make it accessible, keep it fast, and make it look like Stripe built a school safety platform.*

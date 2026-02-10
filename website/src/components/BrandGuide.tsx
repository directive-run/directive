'use client'

import { useState } from 'react'
import clsx from 'clsx'

// ================================================================
// DATA
// ================================================================

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const

const SCALES: Record<string, Record<string, string>> = {
  blue: {
    '50': '#eff6ff', '100': '#dbeafe', '200': '#bfdbfe', '300': '#93c5fd', '400': '#60a5fa',
    '500': '#3b82f6', '600': '#2563eb', '700': '#1d4ed8', '800': '#1e40af', '900': '#1e3a8a', '950': '#172554',
  },
  indigo: {
    '50': '#eef2ff', '100': '#e0e7ff', '200': '#c7d2fe', '300': '#a5b4fc', '400': '#818cf8',
    '500': '#6366f1', '600': '#4f46e5', '700': '#4338ca', '800': '#3730a3', '900': '#312e81', '950': '#1e1b4b',
  },
  violet: {
    '50': '#f5f3ff', '100': '#ede9fe', '200': '#ddd6fe', '300': '#c4b5fd', '400': '#a78bfa',
    '500': '#8b5cf6', '600': '#7c3aed', '700': '#6d28d9', '800': '#5b21b6', '900': '#4c1d95', '950': '#2e1065',
  },
  teal: {
    '50': '#f0fdfa', '100': '#ccfbf1', '200': '#99f6e4', '300': '#5eead4', '400': '#2dd4bf',
    '500': '#14b8a6', '600': '#0d9488', '700': '#0f766e', '800': '#115e59', '900': '#134e4a', '950': '#042f2e',
  },
  emerald: {
    '50': '#ecfdf5', '100': '#d1fae5', '200': '#a7f3d0', '300': '#6ee7b7', '400': '#34d399',
    '500': '#10b981', '600': '#059669', '700': '#047857', '800': '#065f46', '900': '#064e3b', '950': '#022c22',
  },
  amber: {
    '50': '#fffbeb', '100': '#fef3c7', '200': '#fde68a', '300': '#fcd34d', '400': '#fbbf24',
    '500': '#f59e0b', '600': '#d97706', '700': '#b45309', '800': '#92400e', '900': '#78350f', '950': '#451a03',
  },
  sky: {
    '50': '#f0f9ff', '100': '#e0f2fe', '200': '#bae6fd', '300': '#7dd3fc', '400': '#38bdf8',
    '500': '#0ea5e9', '600': '#0284c7', '700': '#0369a1', '800': '#075985', '900': '#0c4a6e', '950': '#082f49',
  },
  slate: {
    '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '300': '#cbd5e1', '400': '#94a3b8',
    '500': '#64748b', '600': '#475569', '700': '#334155', '800': '#1e293b', '900': '#0f172a', '950': '#020617',
  },
}

const COLOR_CANDIDATES = [
  { name: 'Blue', key: 'blue', hex: '#3B82F6', source: 'User pick', notes: 'Cool, confident, infrastructure-grade' },
  { name: 'Indigo', key: 'indigo', hex: '#6366F1', source: 'User pick', notes: 'Blue-purple bridge, dev tooling sweet spot' },
  { name: 'Purple', key: 'violet', hex: '#7C3AED', source: 'User pick', notes: 'Intelligent, authoritative' },
  { name: 'Electric Teal', key: 'teal', hex: '#14B8A6', source: 'AI pick', notes: 'Fresh, distinctive, breaks from blue ecosystem' },
  { name: 'Emerald', key: 'emerald', hex: '#10B981', source: 'AI pick', notes: '\u201CResolved, handled\u201D \u2014 aligns with product promise' },
  { name: 'Amber/Gold', key: 'amber', hex: '#F59E0B', source: 'AI pick', notes: 'Bold, uncommon in dev tools' },
  { name: 'Sky Blue', key: 'sky', hex: '#0EA5E9', source: 'Current', notes: 'Reference only \u2014 very common in TS ecosystem' },
]

const COMBOS = [
  {
    id: 'A',
    primary: { name: 'Purple', hex: '#7C3AED', key: 'violet' },
    accent: { name: 'Emerald', hex: '#10B981', key: 'emerald' },
    gradient: { from: '#ddd6fe', via: '#34d399', to: '#ddd6fe' },
    verdict: 'Product & Strategy favorite \u2014 \u201Cintelligence that delivers\u201D',
  },
  {
    id: 'B',
    primary: { name: 'Teal', hex: '#14B8A6', key: 'teal' },
    accent: { name: 'Purple', hex: '#7C3AED', key: 'violet' },
    gradient: { from: '#99f6e4', via: '#a78bfa', to: '#99f6e4' },
    verdict: 'UX & Marketing favorite \u2014 best accessibility, fresh',
  },
  {
    id: 'C',
    primary: { name: 'Indigo', hex: '#6366F1', key: 'indigo' },
    accent: { name: 'Emerald', hex: '#10B981', key: 'emerald' },
    gradient: { from: '#c7d2fe', via: '#34d399', to: '#c7d2fe' },
    verdict: 'Technical precision + resolution',
  },
  {
    id: 'D',
    primary: { name: 'Purple', hex: '#7C3AED', key: 'violet' },
    accent: { name: 'Amber', hex: '#F59E0B', key: 'amber' },
    gradient: { from: '#ddd6fe', via: '#fbbf24', to: '#ddd6fe' },
    verdict: 'Authority + bold command',
  },
  {
    id: 'E',
    primary: { name: 'Blue', hex: '#3B82F6', key: 'blue' },
    accent: { name: 'Teal', hex: '#14B8A6', key: 'teal' },
    gradient: { from: '#bfdbfe', via: '#2dd4bf', to: '#bfdbfe' },
    verdict: 'Trusted + modern',
  },
  {
    id: 'F',
    primary: { name: 'Indigo', hex: '#6366F1', key: 'indigo' },
    accent: { name: 'Amber', hex: '#F59E0B', key: 'amber' },
    gradient: { from: '#c7d2fe', via: '#fbbf24', to: '#c7d2fe' },
    verdict: 'Precision + authority',
  },
  {
    id: 'G',
    primary: { name: 'Purple', hex: '#7C3AED', key: 'violet' },
    accent: { name: 'Teal', hex: '#14B8A6', key: 'teal' },
    gradient: { from: '#ddd6fe', via: '#2dd4bf', to: '#ddd6fe' },
    verdict: 'Authority + energy',
  },
]

const FONT_PAIRINGS = [
  {
    id: 1,
    display: { name: 'Space Grotesk', family: 'var(--font-space-grotesk), system-ui, sans-serif' },
    body: { name: 'IBM Plex Sans', family: 'var(--font-ibm-plex-sans), system-ui, sans-serif' },
    code: { name: 'IBM Plex Mono', family: 'var(--font-ibm-plex-mono), monospace' },
    notes: 'Top pick (3/4 AEs) \u2014 Technical authority, differentiated from ecosystem',
    topPick: true,
  },
  {
    id: 2,
    display: { name: 'Space Grotesk', family: 'var(--font-space-grotesk), system-ui, sans-serif' },
    body: { name: 'Geist Sans', family: '"Geist", system-ui, -apple-system, sans-serif' },
    code: { name: 'Geist Mono', family: '"Geist Mono", ui-monospace, monospace' },
    notes: 'Modern \u201CVercel aesthetic\u201D, infrastructure-grade feel. Geist fonts require separate installation.',
    topPick: false,
  },
  {
    id: 3,
    display: { name: 'Manrope', family: 'var(--font-manrope), system-ui, sans-serif' },
    body: { name: 'Inter', family: 'var(--font-inter), system-ui, sans-serif' },
    code: { name: 'JetBrains Mono', family: 'var(--font-jetbrains-mono), monospace' },
    notes: 'Safe + one twist. Inter already cached on most devices',
    topPick: false,
  },
  {
    id: 4,
    display: { name: 'Outfit', family: 'var(--font-outfit), system-ui, sans-serif' },
    body: { name: 'IBM Plex Sans', family: 'var(--font-ibm-plex-sans), system-ui, sans-serif' },
    code: { name: 'IBM Plex Mono', family: 'var(--font-ibm-plex-mono), monospace' },
    notes: 'Strong hierarchy, purpose-built for technical docs',
    topPick: false,
  },
  {
    id: 5,
    display: { name: 'Satoshi', family: '"Satoshi", system-ui, -apple-system, sans-serif' },
    body: { name: 'DM Sans', family: 'var(--font-dm-sans), system-ui, sans-serif' },
    code: { name: 'JetBrains Mono', family: 'var(--font-jetbrains-mono), monospace' },
    notes: 'Editorial credibility, premium but approachable. Satoshi requires Fontshare CDN.',
    topPick: false,
  },
]

const SEMANTIC_COLORS = [
  { name: 'Success', hex: '#059669', label: 'Emerald-600', usage: 'Positive outcomes, confirmations' },
  { name: 'Warning', hex: '#D97706', label: 'Amber-600', usage: 'Caution states, non-blocking alerts' },
  { name: 'Error', hex: '#DC2626', label: 'Red-600', usage: 'Failures, blocking issues' },
  { name: 'Info', hex: '#0284C7', label: 'Sky-600', usage: 'Informational, neutral highlights' },
]

const NEUTRAL_LABELS: Record<string, string> = {
  '50': 'Light background',
  '100': 'Alt background',
  '200': 'Border, divider',
  '300': 'Disabled border',
  '400': 'Placeholder text',
  '500': 'Secondary text',
  '600': 'Body text (light mode)',
  '700': 'Strong text (light mode)',
  '800': 'Surface (dark mode)',
  '900': 'Background (dark mode)',
  '950': 'Deep background',
}

const CODE_SAMPLE = `const system = createSystem({
  module: trafficLight,
  plugins: [loggingPlugin()],
});

// Constraints resolve automatically
system.facts.phase = "red";
await system.settle();`

const BODY_SAMPLE =
  'Directive is a constraint-driven runtime for TypeScript. Declare requirements, let resolvers fulfill them, and inspect everything through a unified reactive system with built-in time-travel debugging.'

// ================================================================
// SHARED COMPONENTS
// ================================================================

type PreviewMode = 'light' | 'dark' | 'both'

function ModeToggle({
  mode,
  onChange,
}: {
  mode: PreviewMode
  onChange: (m: PreviewMode) => void
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {(['light', 'dark', 'both'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
            mode === m
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function PreviewPanel({
  mode,
  children,
}: {
  mode: PreviewMode
  children: (dark: boolean) => React.ReactNode
}) {
  if (mode === 'both') {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl bg-[#F8FAFC] p-6 ring-1 ring-slate-200">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Light
          </p>
          {children(false)}
        </div>
        <div className="overflow-hidden rounded-xl bg-[#0F172A] p-6 ring-1 ring-slate-700">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Dark
          </p>
          {children(true)}
        </div>
      </div>
    )
  }
  const isDark = mode === 'dark'
  return (
    <div
      className={clsx(
        'overflow-hidden rounded-xl p-6 ring-1',
        isDark ? 'bg-[#0F172A] ring-slate-700' : 'bg-[#F8FAFC] ring-slate-200',
      )}
    >
      {children(isDark)}
    </div>
  )
}

function SectionHeader({
  title,
  description,
  mode,
  onModeChange,
}: {
  title: string
  description: string
  mode: PreviewMode
  onModeChange: (m: PreviewMode) => void
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      <ModeToggle mode={mode} onChange={onModeChange} />
    </div>
  )
}

function isLightText(shade: string): boolean {
  return parseInt(shade) >= 500
}

function sourceBadgeClasses(source: string, dark: boolean): string {
  if (source === 'Current')
    return dark
      ? 'bg-slate-700 text-slate-300'
      : 'bg-slate-100 text-slate-600'
  if (source === 'AI pick')
    return dark
      ? 'bg-violet-900/30 text-violet-300'
      : 'bg-violet-50 text-violet-700'
  return dark
    ? 'bg-sky-900/30 text-sky-300'
    : 'bg-sky-50 text-sky-700'
}

// ================================================================
// SECTION 1: COLOR PALETTE
// ================================================================

function ColorScaleRow({
  name,
  scaleKey,
  hex,
  source,
  notes,
  dark,
}: {
  name: string
  scaleKey: string
  hex: string
  source: string
  notes: string
  dark: boolean
}) {
  const scale = SCALES[scaleKey]
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3
          className={clsx(
            'text-lg font-semibold',
            dark ? 'text-white' : 'text-slate-900',
          )}
        >
          {name}
        </h3>
        <code
          className={clsx(
            'text-xs',
            dark ? 'text-slate-400' : 'text-slate-500',
          )}
        >
          {hex}
        </code>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-[10px] font-medium',
            sourceBadgeClasses(source, dark),
          )}
        >
          {source}
        </span>
      </div>
      <p
        className={clsx(
          'text-xs',
          dark ? 'text-slate-400' : 'text-slate-500',
        )}
      >
        {notes}
      </p>
      <div className="flex gap-0.5 sm:gap-1">
        {SHADES.map((shade) => (
          <div
            key={shade}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md p-1 sm:gap-1 sm:p-1.5"
            style={{ backgroundColor: scale[shade] }}
          >
            <span
              className={clsx(
                'text-[9px] font-medium sm:text-[10px]',
                isLightText(shade) ? 'text-white/80' : 'text-black/60',
              )}
            >
              {shade}
            </span>
            <span
              className={clsx(
                'hidden font-mono text-[7px] sm:inline sm:text-[8px]',
                isLightText(shade) ? 'text-white/50' : 'text-black/35',
              )}
            >
              {scale[shade]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ColorPaletteSection() {
  const [mode, setMode] = useState<PreviewMode>('both')
  return (
    <section>
      <SectionHeader
        title="1. Brand Color Options"
        description="7 primary color candidates with full 50\u2013950 scales"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-8">
            {COLOR_CANDIDATES.map((color) => (
              <ColorScaleRow
                key={color.key}
                name={color.name}
                scaleKey={color.key}
                hex={color.hex}
                source={color.source}
                notes={color.notes}
                dark={dark}
              />
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  )
}

// ================================================================
// SECTION 2: COMBO PAIRINGS
// ================================================================

function LogoMockup({
  primaryHex,
  accentHex,
  dark,
}: {
  primaryHex: string
  accentHex: string
  dark: boolean
}) {
  return (
    <svg viewBox="0 0 150 36" fill="none" className="h-9 w-auto">
      <g strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 8 L16 18 L6 28" stroke={primaryHex} strokeWidth={3} />
        <path d="M24 8 L24 28" stroke={accentHex} strokeWidth={3} />
      </g>
      <text
        x="38"
        y="25"
        fill={dark ? '#f8fafc' : '#0f172a'}
        style={{
          fontFamily: 'var(--font-lexend), system-ui, sans-serif',
          fontSize: '18px',
          fontWeight: 500,
          letterSpacing: '-0.025em',
        }}
      >
        directive
      </text>
    </svg>
  )
}

function HeroMockup({
  gradient,
}: {
  gradient: { from: string; via: string; to: string }
}) {
  return (
    <p
      className="text-2xl font-bold tracking-tight sm:text-3xl"
      style={{
        backgroundImage: `linear-gradient(to right, ${gradient.from}, ${gradient.via}, ${gradient.to})`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontFamily: 'var(--font-lexend), system-ui, sans-serif',
      }}
    >
      State that resolves itself.
    </p>
  )
}

function UIElements({
  primaryHex,
  accentHex,
  primaryKey,
  dark,
}: {
  primaryHex: string
  accentHex: string
  primaryKey: string
  dark: boolean
}) {
  const scale = SCALES[primaryKey]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-full px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: primaryHex }}
        >
          Get Started
        </button>
        <button
          className="rounded-full border-2 px-4 py-2 text-sm font-semibold"
          style={{ borderColor: accentHex, color: accentHex }}
        >
          View on GitHub
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{ color: primaryHex }}
          className="text-sm font-medium underline underline-offset-2"
        >
          Documentation link
        </a>
        <code
          className="rounded px-2 py-1 font-mono text-xs"
          style={{
            backgroundColor: dark
              ? scale?.['900'] || '#1e1b4b'
              : scale?.['50'] || '#f5f3ff',
            color: dark
              ? scale?.['300'] || '#c4b5fd'
              : scale?.['700'] || '#6d28d9',
          }}
        >
          createModule()
        </code>
      </div>
      <div
        className="rounded-lg border-l-4 p-4"
        style={{
          borderLeftColor: primaryHex,
          backgroundColor: dark
            ? `${primaryHex}10`
            : `${primaryHex}08`,
        }}
      >
        <p
          className="text-sm"
          style={{ color: dark ? '#cbd5e1' : '#334155' }}
        >
          Constraints are evaluated reactively. When facts change, relevant
          constraints re-evaluate automatically.
        </p>
      </div>
    </div>
  )
}

function ComboCard({
  combo,
  dark,
}: {
  combo: (typeof COMBOS)[0]
  dark: boolean
}) {
  return (
    <div
      className={clsx(
        'space-y-5 rounded-xl p-6 ring-1',
        dark
          ? 'bg-slate-800/50 ring-slate-700'
          : 'bg-white ring-slate-200',
      )}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3
            className={clsx(
              'text-lg font-bold',
              dark ? 'text-white' : 'text-slate-900',
            )}
          >
            Option {combo.id}
          </h3>
          <span
            className="inline-flex items-center gap-1.5 text-sm"
            style={{ color: combo.primary.hex }}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: combo.primary.hex }}
            />
            {combo.primary.name}
          </span>
          <span
            className={clsx(
              'text-xs',
              dark ? 'text-slate-500' : 'text-slate-400',
            )}
          >
            +
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-sm"
            style={{ color: combo.accent.hex }}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: combo.accent.hex }}
            />
            {combo.accent.name}
          </span>
        </div>
        <p
          className={clsx(
            'text-xs italic',
            dark ? 'text-slate-400' : 'text-slate-500',
          )}
        >
          AE Verdict: {combo.verdict}
        </p>
      </div>

      <div className="space-y-4">
        <LogoMockup
          primaryHex={combo.primary.hex}
          accentHex={combo.accent.hex}
          dark={dark}
        />
        <HeroMockup gradient={combo.gradient} />
        <UIElements
          primaryHex={combo.primary.hex}
          accentHex={combo.accent.hex}
          primaryKey={combo.primary.key}
          dark={dark}
        />
      </div>
    </div>
  )
}

function ComboPairingsSection() {
  const [mode, setMode] = useState<PreviewMode>('both')
  return (
    <section>
      <SectionHeader
        title="2. Color Combo Pairings"
        description="7 primary + accent combos with logo, hero, and UI mockups"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-6">
            {COMBOS.map((combo) => (
              <ComboCard key={combo.id} combo={combo} dark={dark} />
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  )
}

// ================================================================
// SECTION 3: TYPOGRAPHY
// ================================================================

function TypographyPreview({
  pairing,
  dark,
}: {
  pairing: (typeof FONT_PAIRINGS)[0]
  dark: boolean
}) {
  const textColor = dark ? '#f8fafc' : '#0f172a'
  const mutedColor = dark ? '#94a3b8' : '#64748b'

  return (
    <div
      className={clsx(
        'space-y-6 rounded-xl p-6 ring-1',
        dark
          ? 'bg-slate-800/50 ring-slate-700'
          : 'bg-white ring-slate-200',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            className={clsx(
              'text-lg font-bold',
              dark ? 'text-white' : 'text-slate-900',
            )}
          >
            Option {pairing.id}
          </h3>
          <p
            className={clsx(
              'mt-0.5 text-sm',
              dark ? 'text-slate-400' : 'text-slate-500',
            )}
          >
            {pairing.display.name} &middot; {pairing.body.name} &middot;{' '}
            {pairing.code.name}
          </p>
        </div>
        {pairing.topPick && (
          <span
            className={clsx(
              'rounded-full px-3 py-1 text-[10px] font-semibold',
              dark
                ? 'bg-emerald-900/30 text-emerald-300'
                : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
            )}
          >
            Top Pick (3/4 AEs)
          </span>
        )}
      </div>
      <p
        className={clsx(
          'text-xs',
          dark ? 'text-slate-400' : 'text-slate-500',
        )}
      >
        {pairing.notes}
      </p>

      {/* Heading scale */}
      <div className="space-y-2">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: mutedColor }}
        >
          Headings \u2014 {pairing.display.name}
        </p>
        {[
          { size: '48px', label: 'H1', weight: 700 },
          { size: '36px', label: 'H2', weight: 700 },
          { size: '24px', label: 'H3', weight: 600 },
          { size: '18px', label: 'H4', weight: 600 },
        ].map(({ size, label, weight }) => (
          <p
            key={label}
            style={{
              fontFamily: pairing.display.family,
              fontSize: size,
              fontWeight: weight,
              color: textColor,
              lineHeight: 1.2,
            }}
          >
            {label} \u2014 State that resolves itself
          </p>
        ))}
      </div>

      {/* Body text */}
      <div className="space-y-3">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: mutedColor }}
        >
          Body \u2014 {pairing.body.name}
        </p>
        {['16px', '14px', '12px'].map((size) => (
          <div key={size} className="space-y-1">
            <p
              className="text-[10px] font-mono"
              style={{ color: mutedColor }}
            >
              {size}
            </p>
            <p
              style={{
                fontFamily: pairing.body.family,
                fontSize: size,
                color: textColor,
                lineHeight: 1.6,
              }}
            >
              {BODY_SAMPLE}
            </p>
          </div>
        ))}
      </div>

      {/* Code block */}
      <div className="space-y-2">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: mutedColor }}
        >
          Code \u2014 {pairing.code.name}
        </p>
        <pre
          className="overflow-x-auto rounded-lg p-4 text-sm"
          style={{
            fontFamily: pairing.code.family,
            backgroundColor: dark ? '#0f172a' : '#f1f5f9',
            color: dark ? '#e2e8f0' : '#334155',
            lineHeight: 1.6,
          }}
        >
          {CODE_SAMPLE}
        </pre>
      </div>
    </div>
  )
}

function TypographySection() {
  const [mode, setMode] = useState<PreviewMode>('both')
  return (
    <section>
      <SectionHeader
        title="3. Typography Options"
        description="5 font pairings \u2014 Display + Body + Code"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-6">
            {FONT_PAIRINGS.map((pairing) => (
              <TypographyPreview
                key={pairing.id}
                pairing={pairing}
                dark={dark}
              />
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  )
}

// ================================================================
// SECTION 4: SEMANTIC COLORS
// ================================================================

function SemanticColorsSection() {
  return (
    <section>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
        4. Semantic Colors
      </h2>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Shared across all options \u2014 consistent meaning regardless of brand
        choice
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SEMANTIC_COLORS.map((color) => (
          <div
            key={color.name}
            className="overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700"
          >
            <div className="h-20" style={{ backgroundColor: color.hex }} />
            <div className="p-4">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {color.name}
              </h3>
              <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                {color.label} &middot; {color.hex}
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {color.usage}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ================================================================
// SECTION 5: NEUTRAL SCALE
// ================================================================

function NeutralScaleSection() {
  const [mode, setMode] = useState<PreviewMode>('both')
  const scale = SCALES.slate
  return (
    <section>
      <SectionHeader
        title="5. Neutral Scale"
        description="Full Slate scale with usage labels"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-1">
            {SHADES.map((shade) => (
              <div
                key={shade}
                className="flex items-center gap-4 rounded-lg p-3"
                style={{ backgroundColor: scale[shade] }}
              >
                <span
                  className={clsx(
                    'w-10 text-sm font-bold',
                    isLightText(shade) ? 'text-white/80' : 'text-black/60',
                  )}
                >
                  {shade}
                </span>
                <span
                  className={clsx(
                    'font-mono text-xs',
                    isLightText(shade) ? 'text-white/60' : 'text-black/40',
                  )}
                >
                  {scale[shade]}
                </span>
                <span
                  className={clsx(
                    'text-xs',
                    isLightText(shade) ? 'text-white/70' : 'text-black/50',
                  )}
                >
                  {NEUTRAL_LABELS[shade]}
                </span>
              </div>
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  )
}

// ================================================================
// MAIN EXPORT
// ================================================================

export function BrandGuide() {
  return (
    <div className="space-y-16">
      <ColorPaletteSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <ComboPairingsSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <TypographySection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <SemanticColorsSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <NeutralScaleSection />
    </div>
  )
}

// Brand Preset System — Swappable Color + Typography Themes
// 16 color combos (default + A-P) and 9 typography options (0-8)

export type ColorScale = Record<string, string>

export interface ColorPreset {
  id: string
  name: string
  tagline: string
  primary: { name: string; key: string; hex: string; scale: ColorScale }
  accent: { name: string; key: string; hex: string; scale: ColorScale }
  gradient: { from: string; via: string; to: string }
  verdict: string
}

export interface TypoPreset {
  id: number
  name: string
  display: { name: string; family: string; cssVar: string }
  body: { name: string; family: string; cssVar: string }
  code: { name: string; family: string; cssVar: string }
  notes: string
}

// Full Tailwind shade scales
const SCALES: Record<string, ColorScale> = {
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
  rose: {
    '50': '#fff1f2', '100': '#ffe4e6', '200': '#fecdd3', '300': '#fda4af', '400': '#fb7185',
    '500': '#f43f5e', '600': '#e11d48', '700': '#be123c', '800': '#9f1239', '900': '#881337', '950': '#4c0519',
  },
  cyan: {
    '50': '#ecfeff', '100': '#cffafe', '200': '#a5f3fc', '300': '#67e8f9', '400': '#22d3ee',
    '500': '#06b6d4', '600': '#0891b2', '700': '#0e7490', '800': '#155e75', '900': '#164e63', '950': '#083344',
  },
  zinc: {
    '50': '#fafafa', '100': '#f4f4f5', '200': '#e4e4e7', '300': '#d4d4d8', '400': '#a1a1aa',
    '500': '#71717a', '600': '#52525b', '700': '#3f3f46', '800': '#27272a', '900': '#18181b', '950': '#09090b',
  },
  lime: {
    '50': '#f7fee7', '100': '#ecfccb', '200': '#d9f99d', '300': '#bef264', '400': '#a3e635',
    '500': '#84cc16', '600': '#65a30d', '700': '#4d7c0f', '800': '#3f6212', '900': '#365314', '950': '#1a2e05',
  },
  fuchsia: {
    '50': '#fdf4ff', '100': '#fae8ff', '200': '#f5d0fe', '300': '#f0abfc', '400': '#e879f9',
    '500': '#d946ef', '600': '#c026d3', '700': '#a21caf', '800': '#86198f', '900': '#701a75', '950': '#4a044e',
  },
  slate: {
    '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '300': '#cbd5e1', '400': '#94a3b8',
    '500': '#64748b', '600': '#475569', '700': '#334155', '800': '#1e293b', '900': '#0f172a', '950': '#020617',
  },
  orange: {
    '50': '#fff7ed', '100': '#ffedd5', '200': '#fed7aa', '300': '#fdba74', '400': '#fb923c',
    '500': '#f97316', '600': '#ea580c', '700': '#c2410c', '800': '#9a3412', '900': '#7c2d12', '950': '#431407',
  },
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'A',
    name: 'Constraint Garden',
    tagline: 'Intelligence cultivated, resolution in bloom',
    primary: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    accent: { name: 'Emerald', key: 'emerald', hex: '#10B981', scale: SCALES.emerald },
    gradient: { from: '#ddd6fe', via: '#34d399', to: '#ddd6fe' },
    verdict: 'Product & Strategy favorite — "intelligence that delivers"',
  },
  {
    id: 'B',
    name: 'Deep Resolve',
    tagline: 'Fresh perspective with purple depth',
    primary: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    accent: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#99f6e4', via: '#a78bfa', to: '#99f6e4' },
    verdict: 'UX & Marketing favorite — best accessibility, fresh',
  },
  {
    id: 'C',
    name: 'Logic Gate',
    tagline: 'Where precision meets green-light resolution',
    primary: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    accent: { name: 'Emerald', key: 'emerald', hex: '#10B981', scale: SCALES.emerald },
    gradient: { from: '#c7d2fe', via: '#34d399', to: '#c7d2fe' },
    verdict: 'Technical precision + resolution',
  },
  {
    id: 'D',
    name: 'Royal Command',
    tagline: 'Directive authority, no ambiguity',
    primary: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    accent: { name: 'Amber', key: 'amber', hex: '#F59E0B', scale: SCALES.amber },
    gradient: { from: '#ddd6fe', via: '#fbbf24', to: '#ddd6fe' },
    verdict: 'Authority + bold command',
  },
  {
    id: 'E',
    name: 'Trusted Current',
    tagline: 'Reliable foundations, modern flow',
    primary: { name: 'Blue', key: 'blue', hex: '#3B82F6', scale: SCALES.blue },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#bfdbfe', via: '#2dd4bf', to: '#bfdbfe' },
    verdict: 'Trusted + modern',
  },
  {
    id: 'F',
    name: 'Midnight Signal',
    tagline: 'Precision alerts in the dark',
    primary: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    accent: { name: 'Amber', key: 'amber', hex: '#F59E0B', scale: SCALES.amber },
    gradient: { from: '#c7d2fe', via: '#fbbf24', to: '#c7d2fe' },
    verdict: 'Precision + authority',
  },
  {
    id: 'G',
    name: 'Neon Authority',
    tagline: 'Electric confidence, full spectrum',
    primary: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#ddd6fe', via: '#2dd4bf', to: '#ddd6fe' },
    verdict: 'Authority + energy',
  },
  {
    id: 'H',
    name: 'Stack Depth',
    tagline: 'Enterprise trust runs deep',
    primary: { name: 'Blue', key: 'blue', hex: '#3B82F6', scale: SCALES.blue },
    accent: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#bfdbfe', via: '#a78bfa', to: '#bfdbfe' },
    verdict: 'Trusted foundation + intelligent depth',
  },
  {
    id: 'I',
    name: 'Terminal Flare',
    tagline: 'High contrast, maximum clarity',
    primary: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    accent: { name: 'Amber', key: 'amber', hex: '#F59E0B', scale: SCALES.amber },
    gradient: { from: '#99f6e4', via: '#fbbf24', to: '#99f6e4' },
    verdict: 'Highest-contrast complementary pair, visually arresting',
  },
  {
    id: 'J',
    name: 'Cold Fusion',
    tagline: 'Cool precision, zero friction',
    primary: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#c7d2fe', via: '#2dd4bf', to: '#c7d2fe' },
    verdict: 'Cool-spectrum with excellent contrast ratios',
  },
  {
    id: 'K',
    name: 'Resolved State',
    tagline: "The green light. It's done.",
    primary: { name: 'Emerald', key: 'emerald', hex: '#10B981', scale: SCALES.emerald },
    accent: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#a7f3d0', via: '#a78bfa', to: '#a7f3d0' },
    verdict: 'Flipped A — green-primary, high trademark distinctiveness',
  },
  // New presets L-P
  {
    id: 'L',
    name: 'Exception Caught',
    tagline: 'Warm meets cool, error meets resolution',
    primary: { name: 'Rose', key: 'rose', hex: '#F43F5E', scale: SCALES.rose },
    accent: { name: 'Cyan', key: 'cyan', hex: '#06B6D4', scale: SCALES.cyan },
    gradient: { from: '#fecdd3', via: '#22d3ee', to: '#fecdd3' },
    verdict: 'Bold warmth balanced by cool precision',
  },
  {
    id: 'M',
    name: 'Stealth Mode',
    tagline: 'Muted authority, electric accent',
    primary: { name: 'Zinc', key: 'zinc', hex: '#71717A', scale: SCALES.zinc },
    accent: { name: 'Lime', key: 'lime', hex: '#84CC16', scale: SCALES.lime },
    gradient: { from: '#d4d4d8', via: '#a3e635', to: '#d4d4d8' },
    verdict: 'Understated base with high-energy accent',
  },
  {
    id: 'N',
    name: 'Runtime Pulse',
    tagline: 'Maximum energy, zero friction',
    primary: { name: 'Fuchsia', key: 'fuchsia', hex: '#D946EF', scale: SCALES.fuchsia },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#f5d0fe', via: '#2dd4bf', to: '#f5d0fe' },
    verdict: 'Vibrant energy with grounded cool accent',
  },
  {
    id: 'O',
    name: 'Quiet Authority',
    tagline: 'Color speaks only when it matters',
    primary: { name: 'Slate', key: 'slate', hex: '#64748B', scale: SCALES.slate },
    accent: { name: 'Violet', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#cbd5e1', via: '#a78bfa', to: '#cbd5e1' },
    verdict: 'Professional restraint with intelligent accent',
  },
  {
    id: 'P',
    name: 'Constraint Fire',
    tagline: 'Urgent energy, deep precision',
    primary: { name: 'Orange', key: 'orange', hex: '#F97316', scale: SCALES.orange },
    accent: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    gradient: { from: '#fed7aa', via: '#818cf8', to: '#fed7aa' },
    verdict: 'High-energy primary with deep precision accent',
  },
]

export const TYPO_PRESETS: TypoPreset[] = [
  {
    id: 1,
    name: 'Systems Grade',
    display: { name: 'Space Grotesk', family: '"Space Grotesk", system-ui, sans-serif', cssVar: '--font-space-grotesk' },
    body: { name: 'IBM Plex Sans', family: '"IBM Plex Sans", system-ui, sans-serif', cssVar: '--font-ibm-plex-sans' },
    code: { name: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace', cssVar: '--font-ibm-plex-mono' },
    notes: 'Top pick (3/4 AEs) — Technical authority, differentiated from ecosystem',
  },
  {
    id: 2,
    name: 'Vercel Shift',
    display: { name: 'Space Grotesk', family: '"Space Grotesk", system-ui, sans-serif', cssVar: '--font-space-grotesk' },
    body: { name: 'Geist Sans', family: '"Geist", system-ui, -apple-system, sans-serif', cssVar: '--font-geist-sans' },
    code: { name: 'Geist Mono', family: '"Geist Mono", ui-monospace, monospace', cssVar: '--font-geist-mono' },
    notes: 'Modern "Vercel aesthetic", infrastructure-grade feel',
  },
  {
    id: 3,
    name: 'Safe Twist',
    display: { name: 'Manrope', family: '"Manrope", system-ui, sans-serif', cssVar: '--font-manrope' },
    body: { name: 'Inter', family: '"Inter", system-ui, sans-serif', cssVar: '--font-inter' },
    code: { name: 'JetBrains Mono', family: '"JetBrains Mono", monospace', cssVar: '--font-jetbrains-mono' },
    notes: 'Safe + one twist. Inter already cached on most devices',
  },
  {
    id: 4,
    name: 'Doc Standard',
    display: { name: 'Outfit', family: '"Outfit", system-ui, sans-serif', cssVar: '--font-outfit' },
    body: { name: 'IBM Plex Sans', family: '"IBM Plex Sans", system-ui, sans-serif', cssVar: '--font-ibm-plex-sans' },
    code: { name: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace', cssVar: '--font-ibm-plex-mono' },
    notes: 'Strong hierarchy, purpose-built for technical docs',
  },
  {
    id: 5,
    name: 'Editorial Mode',
    display: { name: 'Satoshi', family: '"Satoshi", system-ui, -apple-system, sans-serif', cssVar: '--font-satoshi' },
    body: { name: 'DM Sans', family: '"DM Sans", system-ui, sans-serif', cssVar: '--font-dm-sans' },
    code: { name: 'JetBrains Mono', family: '"JetBrains Mono", monospace', cssVar: '--font-jetbrains-mono' },
    notes: 'Editorial credibility, premium but approachable',
  },
  // New typography presets 6-8
  {
    id: 6,
    name: 'Jakarta Standard',
    display: { name: 'Plus Jakarta Sans', family: '"Plus Jakarta Sans", system-ui, sans-serif', cssVar: '--font-plus-jakarta-sans' },
    body: { name: 'Source Sans 3', family: '"Source Sans 3", system-ui, sans-serif', cssVar: '--font-source-sans-3' },
    code: { name: 'Source Code Pro', family: '"Source Code Pro", monospace', cssVar: '--font-source-code-pro' },
    notes: 'Clean geometric display with neutral professional body',
  },
  {
    id: 7,
    name: 'Retro Terminal',
    display: { name: 'Bricolage Grotesque', family: '"Bricolage Grotesque", system-ui, sans-serif', cssVar: '--font-bricolage-grotesque' },
    body: { name: 'Geist Sans', family: '"Geist", system-ui, -apple-system, sans-serif', cssVar: '--font-geist-sans' },
    code: { name: 'Fira Code', family: '"Fira Code", monospace', cssVar: '--font-fira-code' },
    notes: 'Eclectic display with modern body and ligature-rich code font',
  },
  {
    id: 8,
    name: 'Precision Stack',
    display: { name: 'General Sans', family: '"General Sans", system-ui, sans-serif', cssVar: '--font-general-sans' },
    body: { name: 'Inter', family: '"Inter", system-ui, sans-serif', cssVar: '--font-inter' },
    code: { name: 'Berkeley Mono', family: '"Berkeley Mono", ui-monospace, monospace', cssVar: '--font-berkeley-mono' },
    notes: 'Premium geometric display with trusted body and luxury code font',
  },
]

// Default preset: current site colors (Sky + Indigo) — not in the A-K list
export const DEFAULT_COLOR_PRESET: ColorPreset = {
  id: 'default',
  name: 'Blueprint',
  tagline: 'Where it all started',
  primary: { name: 'Sky', key: 'sky', hex: '#0EA5E9', scale: SCALES.sky },
  accent: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
  gradient: { from: '#bae6fd', via: '#818cf8', to: '#bae6fd' },
  verdict: 'Current site default',
}

// Default typography: current site fonts (Lexend + Inter)
export const DEFAULT_TYPO_PRESET: TypoPreset = {
  id: 0,
  name: 'Foundation',
  display: { name: 'Lexend', family: 'var(--font-lexend)', cssVar: '--font-lexend' },
  body: { name: 'Inter', family: 'var(--font-inter)', cssVar: '--font-inter' },
  code: { name: 'System Mono', family: 'ui-monospace, monospace', cssVar: '' },
  notes: 'Current site default (Lexend + Inter)',
}

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const

// Rotation pool: WCAG-safe presets for random first-visit assignment
// Excludes amber-accent presets (D, F, I) which can fail WCAG AA on light backgrounds
// Excludes P (orange primary — needs contrast audit)
export const ROTATION_POOL_IDS = ['default', 'A', 'B', 'C', 'E', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O'] as const

export const ALL_COLOR_IDS: string[] = [DEFAULT_COLOR_PRESET.id, ...COLOR_PRESETS.map(p => p.id)]
export const ALL_TYPO_IDS: number[] = [DEFAULT_TYPO_PRESET.id, ...TYPO_PRESETS.map(p => p.id)]

export function getAllColors(): ColorPreset[] {
  return [DEFAULT_COLOR_PRESET, ...COLOR_PRESETS]
}

export function getAllTypos(): TypoPreset[] {
  return [DEFAULT_TYPO_PRESET, ...TYPO_PRESETS]
}

export function findColorPreset(id: string): ColorPreset | undefined {
  if (id === 'default') return DEFAULT_COLOR_PRESET
  return COLOR_PRESETS.find((p) => p.id === id)
}

export function findTypoPreset(id: number): TypoPreset | undefined {
  if (id === 0) return DEFAULT_TYPO_PRESET
  return TYPO_PRESETS.find((p) => p.id === id)
}

export function getRandomPreset(): { colorId: string; typoId: number } {
  const allTypos = getAllTypos()
  const colorId = ROTATION_POOL_IDS[Math.floor(Math.random() * ROTATION_POOL_IDS.length)]
  const typoId = allTypos[Math.floor(Math.random() * allTypos.length)].id
  return { colorId, typoId }
}

export function applyColorPreset(preset: ColorPreset) {
  const root = document.documentElement.style
  for (const shade of SHADES) {
    root.setProperty(`--brand-primary-${shade}`, preset.primary.scale[shade])
    root.setProperty(`--brand-accent-${shade}`, preset.accent.scale[shade])
  }
  root.setProperty('--brand-primary', preset.primary.scale['500'])
  root.setProperty('--brand-accent', preset.accent.scale['500'])
  root.setProperty('--brand-gradient-from', preset.gradient.from)
  root.setProperty('--brand-gradient-via', preset.gradient.via)
  root.setProperty('--brand-gradient-to', preset.gradient.to)
}

export function applyTypoPreset(preset: TypoPreset) {
  const root = document.documentElement.style
  root.setProperty('--brand-font-display', preset.display.cssVar ? `var(${preset.display.cssVar})` : preset.display.family)
  root.setProperty('--brand-font-body', preset.body.cssVar ? `var(${preset.body.cssVar})` : preset.body.family)
  root.setProperty('--brand-font-code', preset.code.cssVar ? `var(${preset.code.cssVar})` : preset.code.family)
}

export function applyFontSize(scale: number) {
  document.documentElement.style.fontSize = `${scale}%`
}

export function clearFontSize() {
  document.documentElement.style.removeProperty('font-size')
}

export function clearPresets() {
  const root = document.documentElement.style
  const props = [
    '--brand-primary', '--brand-accent',
    '--brand-gradient-from', '--brand-gradient-via', '--brand-gradient-to',
    '--brand-font-display', '--brand-font-body', '--brand-font-code',
  ]
  for (const shade of SHADES) {
    props.push(`--brand-primary-${shade}`, `--brand-accent-${shade}`)
  }
  for (const prop of props) {
    root.removeProperty(prop)
  }
  clearFontSize()
}


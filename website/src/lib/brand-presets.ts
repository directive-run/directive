// Brand Preset System — Swappable Color + Typography Themes
// All 11 color combos (A-K) and 5 typography options from BrandGuide

export type ColorScale = Record<string, string>

export interface ColorPreset {
  id: string
  primary: { name: string; key: string; hex: string; scale: ColorScale }
  accent: { name: string; key: string; hex: string; scale: ColorScale }
  gradient: { from: string; via: string; to: string }
  verdict: string
}

export interface TypoPreset {
  id: number
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
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'A',
    primary: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    accent: { name: 'Emerald', key: 'emerald', hex: '#10B981', scale: SCALES.emerald },
    gradient: { from: '#ddd6fe', via: '#34d399', to: '#ddd6fe' },
    verdict: 'Product & Strategy favorite — "intelligence that delivers"',
  },
  {
    id: 'B',
    primary: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    accent: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#99f6e4', via: '#a78bfa', to: '#99f6e4' },
    verdict: 'UX & Marketing favorite — best accessibility, fresh',
  },
  {
    id: 'C',
    primary: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    accent: { name: 'Emerald', key: 'emerald', hex: '#10B981', scale: SCALES.emerald },
    gradient: { from: '#c7d2fe', via: '#34d399', to: '#c7d2fe' },
    verdict: 'Technical precision + resolution',
  },
  {
    id: 'D',
    primary: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    accent: { name: 'Amber', key: 'amber', hex: '#F59E0B', scale: SCALES.amber },
    gradient: { from: '#ddd6fe', via: '#fbbf24', to: '#ddd6fe' },
    verdict: 'Authority + bold command',
  },
  {
    id: 'E',
    primary: { name: 'Blue', key: 'blue', hex: '#3B82F6', scale: SCALES.blue },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#bfdbfe', via: '#2dd4bf', to: '#bfdbfe' },
    verdict: 'Trusted + modern',
  },
  {
    id: 'F',
    primary: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    accent: { name: 'Amber', key: 'amber', hex: '#F59E0B', scale: SCALES.amber },
    gradient: { from: '#c7d2fe', via: '#fbbf24', to: '#c7d2fe' },
    verdict: 'Precision + authority',
  },
  {
    id: 'G',
    primary: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#ddd6fe', via: '#2dd4bf', to: '#ddd6fe' },
    verdict: 'Authority + energy',
  },
  {
    id: 'H',
    primary: { name: 'Blue', key: 'blue', hex: '#3B82F6', scale: SCALES.blue },
    accent: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#bfdbfe', via: '#a78bfa', to: '#bfdbfe' },
    verdict: 'Trusted foundation + intelligent depth',
  },
  {
    id: 'I',
    primary: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    accent: { name: 'Amber', key: 'amber', hex: '#F59E0B', scale: SCALES.amber },
    gradient: { from: '#99f6e4', via: '#fbbf24', to: '#99f6e4' },
    verdict: 'Highest-contrast complementary pair, visually arresting',
  },
  {
    id: 'J',
    primary: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
    accent: { name: 'Teal', key: 'teal', hex: '#14B8A6', scale: SCALES.teal },
    gradient: { from: '#c7d2fe', via: '#2dd4bf', to: '#c7d2fe' },
    verdict: 'Cool-spectrum with excellent contrast ratios',
  },
  {
    id: 'K',
    primary: { name: 'Emerald', key: 'emerald', hex: '#10B981', scale: SCALES.emerald },
    accent: { name: 'Purple', key: 'violet', hex: '#7C3AED', scale: SCALES.violet },
    gradient: { from: '#a7f3d0', via: '#a78bfa', to: '#a7f3d0' },
    verdict: 'Flipped A — green-primary, high trademark distinctiveness',
  },
]

export const TYPO_PRESETS: TypoPreset[] = [
  {
    id: 1,
    display: { name: 'Space Grotesk', family: '"Space Grotesk", system-ui, sans-serif', cssVar: '--font-space-grotesk' },
    body: { name: 'IBM Plex Sans', family: '"IBM Plex Sans", system-ui, sans-serif', cssVar: '--font-ibm-plex-sans' },
    code: { name: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace', cssVar: '--font-ibm-plex-mono' },
    notes: 'Top pick (3/4 AEs) — Technical authority, differentiated from ecosystem',
  },
  {
    id: 2,
    display: { name: 'Space Grotesk', family: '"Space Grotesk", system-ui, sans-serif', cssVar: '--font-space-grotesk' },
    body: { name: 'Geist Sans', family: '"Geist", system-ui, -apple-system, sans-serif', cssVar: '--font-geist-sans' },
    code: { name: 'Geist Mono', family: '"Geist Mono", ui-monospace, monospace', cssVar: '--font-geist-mono' },
    notes: 'Modern "Vercel aesthetic", infrastructure-grade feel',
  },
  {
    id: 3,
    display: { name: 'Manrope', family: '"Manrope", system-ui, sans-serif', cssVar: '--font-manrope' },
    body: { name: 'Inter', family: '"Inter", system-ui, sans-serif', cssVar: '--font-inter' },
    code: { name: 'JetBrains Mono', family: '"JetBrains Mono", monospace', cssVar: '--font-jetbrains-mono' },
    notes: 'Safe + one twist. Inter already cached on most devices',
  },
  {
    id: 4,
    display: { name: 'Outfit', family: '"Outfit", system-ui, sans-serif', cssVar: '--font-outfit' },
    body: { name: 'IBM Plex Sans', family: '"IBM Plex Sans", system-ui, sans-serif', cssVar: '--font-ibm-plex-sans' },
    code: { name: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace', cssVar: '--font-ibm-plex-mono' },
    notes: 'Strong hierarchy, purpose-built for technical docs',
  },
  {
    id: 5,
    display: { name: 'Satoshi', family: '"Satoshi", system-ui, -apple-system, sans-serif', cssVar: '--font-satoshi' },
    body: { name: 'DM Sans', family: '"DM Sans", system-ui, sans-serif', cssVar: '--font-dm-sans' },
    code: { name: 'JetBrains Mono', family: '"JetBrains Mono", monospace', cssVar: '--font-jetbrains-mono' },
    notes: 'Editorial credibility, premium but approachable',
  },
]

// Default preset: current site colors (Sky + Indigo) — not in the A-K list
export const DEFAULT_COLOR_PRESET: ColorPreset = {
  id: 'default',
  primary: { name: 'Sky', key: 'sky', hex: '#0EA5E9', scale: SCALES.sky },
  accent: { name: 'Indigo', key: 'indigo', hex: '#6366F1', scale: SCALES.indigo },
  gradient: { from: '#bae6fd', via: '#818cf8', to: '#bae6fd' },
  verdict: 'Current site default',
}

// Default typography: current site fonts (Lexend + Inter)
export const DEFAULT_TYPO_PRESET: TypoPreset = {
  id: 0,
  display: { name: 'Lexend', family: 'var(--font-lexend)', cssVar: '--font-lexend' },
  body: { name: 'Inter', family: 'var(--font-inter)', cssVar: '--font-inter' },
  code: { name: 'System Mono', family: 'ui-monospace, monospace', cssVar: '' },
  notes: 'Current site default (Lexend + Inter)',
}

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const

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
}

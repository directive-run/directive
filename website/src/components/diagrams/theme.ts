import type { ColorScheme, NodeStatus } from './types'

// Turbo Flow theme constants

interface ColorSet {
  bg: string
  bgActive: string
  border: string
  borderActive: string
  text: string
  textActive: string
}

const COLOR_MAP: Record<ColorScheme, ColorSet> = {
  primary: {
    bg: 'bg-sky-50 dark:bg-sky-950/50',
    bgActive: 'bg-sky-100 dark:bg-sky-900/80',
    border: 'border-sky-300 dark:border-sky-700',
    borderActive: 'border-sky-500 dark:border-sky-400',
    text: 'text-sky-700 dark:text-sky-300',
    textActive: 'text-sky-800 dark:text-sky-200',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    bgActive: 'bg-amber-100 dark:bg-amber-900/80',
    border: 'border-amber-300 dark:border-amber-700',
    borderActive: 'border-amber-500 dark:border-amber-400',
    text: 'text-amber-700 dark:text-amber-300',
    textActive: 'text-amber-800 dark:text-amber-200',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/50',
    bgActive: 'bg-violet-100 dark:bg-violet-900/80',
    border: 'border-violet-300 dark:border-violet-700',
    borderActive: 'border-violet-500 dark:border-violet-400',
    text: 'text-violet-700 dark:text-violet-300',
    textActive: 'text-violet-800 dark:text-violet-200',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    bgActive: 'bg-emerald-100 dark:bg-emerald-900/80',
    border: 'border-emerald-300 dark:border-emerald-700',
    borderActive: 'border-emerald-500 dark:border-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
    textActive: 'text-emerald-800 dark:text-emerald-200',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-950/50',
    bgActive: 'bg-red-100 dark:bg-red-900/80',
    border: 'border-red-300 dark:border-red-700',
    borderActive: 'border-red-500 dark:border-red-400',
    text: 'text-red-700 dark:text-red-300',
    textActive: 'text-red-800 dark:text-red-200',
  },
  slate: {
    bg: 'bg-slate-50 dark:bg-slate-800',
    bgActive: 'bg-slate-100 dark:bg-slate-700',
    border: 'border-slate-300 dark:border-slate-600',
    borderActive: 'border-slate-400 dark:border-slate-500',
    text: 'text-slate-700 dark:text-slate-200',
    textActive: 'text-slate-800 dark:text-slate-100',
  },
}

export function getNodeColors(scheme: ColorScheme, status: NodeStatus): { bg: string; border: string; text: string } {
  const colors = COLOR_MAP[scheme]
  const isActive = status === 'active'

  return {
    bg: isActive ? colors.bgActive : colors.bg,
    border: isActive ? colors.borderActive : colors.border,
    text: isActive ? colors.textActive : colors.text,
  }
}

export function getEdgeColor(scheme: ColorScheme, active: boolean): string {
  const hexMap: Record<ColorScheme, { normal: string; active: string }> = {
    primary: { normal: '#94a3b8', active: '#0ea5e9' },
    amber: { normal: '#94a3b8', active: '#f59e0b' },
    violet: { normal: '#94a3b8', active: '#8b5cf6' },
    emerald: { normal: '#94a3b8', active: '#10b981' },
    red: { normal: '#94a3b8', active: '#ef4444' },
    slate: { normal: '#94a3b8', active: '#64748b' },
  }
  const entry = hexMap[scheme]

  return active ? entry.active : entry.normal
}

export function getEdgeColorDark(scheme: ColorScheme, active: boolean): string {
  const hexMap: Record<ColorScheme, { normal: string; active: string }> = {
    primary: { normal: '#475569', active: '#38bdf8' },
    amber: { normal: '#475569', active: '#fbbf24' },
    violet: { normal: '#475569', active: '#a78bfa' },
    emerald: { normal: '#475569', active: '#34d399' },
    red: { normal: '#475569', active: '#f87171' },
    slate: { normal: '#475569', active: '#94a3b8' },
  }
  const entry = hexMap[scheme]

  return active ? entry.active : entry.normal
}

export const LAYER_COLORS: Record<ColorScheme, { bg: string; bgActive: string; border: string; borderActive: string }> = {
  primary: {
    bg: 'bg-sky-50/50 dark:bg-sky-950/30',
    bgActive: 'bg-sky-50 dark:bg-sky-950/50',
    border: 'border-slate-200 dark:border-slate-700',
    borderActive: 'border-sky-300 dark:border-sky-700',
  },
  amber: {
    bg: 'bg-amber-50/50 dark:bg-amber-950/30',
    bgActive: 'bg-amber-50 dark:bg-amber-950/50',
    border: 'border-slate-200 dark:border-slate-700',
    borderActive: 'border-amber-300 dark:border-amber-700',
  },
  violet: {
    bg: 'bg-violet-50/50 dark:bg-violet-950/30',
    bgActive: 'bg-violet-50 dark:bg-violet-950/50',
    border: 'border-slate-200 dark:border-slate-700',
    borderActive: 'border-violet-300 dark:border-violet-700',
  },
  emerald: {
    bg: 'bg-emerald-50/50 dark:bg-emerald-950/30',
    bgActive: 'bg-emerald-50 dark:bg-emerald-950/50',
    border: 'border-slate-200 dark:border-slate-700',
    borderActive: 'border-emerald-300 dark:border-emerald-700',
  },
  red: {
    bg: 'bg-red-50/50 dark:bg-red-950/30',
    bgActive: 'bg-red-50 dark:bg-red-950/50',
    border: 'border-slate-200 dark:border-slate-700',
    borderActive: 'border-red-300 dark:border-red-700',
  },
  slate: {
    bg: 'bg-slate-50/50 dark:bg-slate-900/30',
    bgActive: 'bg-slate-50 dark:bg-slate-800/50',
    border: 'border-slate-200 dark:border-slate-700',
    borderActive: 'border-slate-300 dark:border-slate-600',
  },
}

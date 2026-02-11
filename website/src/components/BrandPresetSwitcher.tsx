'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import {
  COLOR_PRESETS,
  TYPO_PRESETS,
  DEFAULT_COLOR_PRESET,
  DEFAULT_TYPO_PRESET,
  applyColorPreset,
  applyTypoPreset,
  clearPresets,
  type ColorPreset,
  type TypoPreset,
} from '@/lib/brand-presets'

const STORAGE_KEY_COLOR = 'directive-brand-color'
const STORAGE_KEY_TYPO = 'directive-brand-typo'

export const BrandPresetSwitcher = memo(function BrandPresetSwitcher({
  className,
}: {
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [colorId, setColorId] = useState<string>('default')
  const [typoId, setTypoId] = useState<number>(0)
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    const savedColor = localStorage.getItem(STORAGE_KEY_COLOR)
    const savedTypo = localStorage.getItem(STORAGE_KEY_TYPO)

    if (savedColor) {
      const preset = savedColor === 'default'
        ? DEFAULT_COLOR_PRESET
        : COLOR_PRESETS.find((p) => p.id === savedColor)
      if (preset) {
        setColorId(savedColor)
        applyColorPreset(preset)
      }
    }

    if (savedTypo) {
      const id = parseInt(savedTypo, 10)
      const preset = id === 0
        ? DEFAULT_TYPO_PRESET
        : TYPO_PRESETS.find((p) => p.id === id)
      if (preset) {
        setTypoId(id)
        applyTypoPreset(preset)
      }
    }
  }, [])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleColorChange = useCallback((preset: ColorPreset) => {
    setColorId(preset.id)
    applyColorPreset(preset)
    localStorage.setItem(STORAGE_KEY_COLOR, preset.id)
  }, [])

  const handleTypoChange = useCallback((preset: TypoPreset) => {
    setTypoId(preset.id)
    applyTypoPreset(preset)
    localStorage.setItem(STORAGE_KEY_TYPO, String(preset.id))
  }, [])

  const handleReset = useCallback(() => {
    clearPresets()
    setColorId('default')
    setTypoId(0)
    localStorage.removeItem(STORAGE_KEY_COLOR)
    localStorage.removeItem(STORAGE_KEY_TYPO)
  }, [])

  if (!mounted) {
    return <div className={clsx('h-10 w-10 sm:h-6 sm:w-6', className)} suppressHydrationWarning />
  }

  const allColors = [DEFAULT_COLOR_PRESET, ...COLOR_PRESETS]
  const allTypos = [DEFAULT_TYPO_PRESET, ...TYPO_PRESETS]

  return (
    <div className={clsx('relative', className)} ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-lg shadow-md ring-1 shadow-black/5 ring-black/5 sm:h-6 sm:w-6 dark:ring-brand-primary/50',
          isOpen
            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
            : 'bg-white text-slate-500 dark:bg-slate-600 dark:text-slate-300'
        )}
        aria-label="Toggle brand preset switcher"
        title="Brand Preset Switcher"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-3 w-80 rounded-xl bg-white p-4 shadow-md ring-1 shadow-black/5 ring-black/5 dark:bg-slate-800 dark:ring-white/5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Brand Presets
            </h3>
            <button
              onClick={handleReset}
              className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Reset
            </button>
          </div>

          {/* Color Combos */}
          <div className="mb-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Color Combo
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {allColors.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleColorChange(preset)}
                  className={clsx(
                    'group relative flex flex-col items-center gap-0.5 rounded-lg p-1.5 transition',
                    colorId === preset.id
                      ? 'bg-slate-100 ring-2 ring-slate-900 dark:bg-slate-700 dark:ring-white'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  )}
                  title={preset.id === 'default' ? 'Default (Sky + Indigo)' : `${preset.id}: ${preset.primary.name} + ${preset.accent.name}`}
                >
                  <div className="flex gap-0.5">
                    <span
                      className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: preset.primary.hex }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: preset.accent.hex }}
                    />
                  </div>
                  <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400">
                    {preset.id === 'default' ? 'Def' : preset.id}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Typography */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Typography
            </p>
            <div className="space-y-1">
              {allTypos.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleTypoChange(preset)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition',
                    typoId === preset.id
                      ? 'bg-slate-100 font-medium text-slate-900 ring-1 ring-slate-300 dark:bg-slate-700 dark:text-white dark:ring-slate-500'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50'
                  )}
                >
                  <span className="w-4 flex-none text-center font-mono text-[10px] text-slate-400">
                    {preset.id === 0 ? '-' : preset.id}
                  </span>
                  <span className="truncate">
                    {preset.display.name} + {preset.body.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Current selection info */}
          <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
            <p className="text-[10px] text-slate-400">
              {colorId === 'default' ? 'Default colors' : `Combo ${colorId}`}
              {' / '}
              {typoId === 0 ? 'Default fonts' : `Type ${typoId}`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
})

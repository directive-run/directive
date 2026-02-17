'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { DotsThreeVertical } from '@phosphor-icons/react'

import {
  COLOR_PRESETS,
  TYPO_PRESETS,
  DEFAULT_COLOR_PRESET,
  DEFAULT_TYPO_PRESET,
  findColorPreset,
} from '@/lib/brand-presets'
import { useThemePresets } from '@/lib/useThemePresets'
import { ThemeToggle } from '@/components/ThemeSelector'

export const LabsThemePanel = memo(function LabsThemePanel() {
  const {
    colorId,
    typoId,
    fontScale,
    mounted,
    handleColorChange,
    handleTypoChange,
    handleFontSizeChange,
    handleReset,
    handleColorHover,
    handleColorLeave,
  } = useThemePresets()

  if (!mounted) {
    return <div className="h-96 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
  }

  const allColors = [DEFAULT_COLOR_PRESET, ...COLOR_PRESETS]
  const allTypos = [DEFAULT_TYPO_PRESET, ...TYPO_PRESETS]
  const currentColor = findColorPreset(colorId) ?? DEFAULT_COLOR_PRESET

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Theme Customization
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {currentColor.name} &ndash; {currentColor.tagline}
            </p>
          </div>

          {/* Mobile: dropdown trigger */}
          <MobileResetDropdown onReset={handleReset} />
        </div>

        {/* Desktop: visible button */}
        <button
          onClick={handleReset}
          className="mt-3 hidden rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 sm:inline-flex dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Reset All
        </button>
      </div>

      {/* Dark/Light Toggle */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Appearance
        </h3>
        <ThemeToggle />
      </div>

      {/* Color Presets */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Color Preset
        </h3>
        <div
          role="group"
          aria-label="Color presets"
          className="grid grid-cols-6 gap-2 sm:grid-cols-9"
          onMouseLeave={handleColorLeave}
        >
          {allColors.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleColorChange(preset)}
              onMouseEnter={() => handleColorHover(preset)}
              className={clsx(
                'group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl px-1 pt-3 pb-2 transition',
                colorId === preset.id
                  ? 'bg-slate-100 ring-2 ring-brand-primary dark:bg-slate-700'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
              )}
              aria-label={`${preset.name}: ${preset.primary.name} + ${preset.accent.name}`}
              title={`${preset.name}: ${preset.primary.name} + ${preset.accent.name}`}
            >
              <div className="flex gap-0.5">
                <span
                  className="h-4 w-4 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: preset.primary.hex }}
                />
                <span
                  className="h-4 w-4 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: preset.accent.hex }}
                />
              </div>
              <span className="max-w-full truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">
                {preset.id === 'default' ? 'Default' : preset.id}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Typography Presets */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Typography
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {allTypos.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleTypoChange(preset)}
              className={clsx(
                'flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition',
                typoId === preset.id
                  ? 'bg-slate-100 ring-2 ring-brand-primary dark:bg-slate-700'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
              )}
            >
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-200 text-sm font-bold text-slate-500 dark:bg-slate-600 dark:text-slate-300"
                style={{ fontFamily: preset.display.family }}
              >
                Aa
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                  {preset.name}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {preset.display.name} &middot; {preset.body.name} &middot; {preset.code.name}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Font Size
        </h3>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">A</span>
          <input
            type="range"
            min={80}
            max={150}
            step={10}
            value={fontScale}
            onChange={(e) => handleFontSizeChange(Number(e.target.value))}
            aria-label="Font size"
            aria-valuenow={fontScale}
            aria-valuemin={80}
            aria-valuemax={150}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-primary dark:bg-slate-700"
          />
          <span className="text-base text-slate-400">A</span>
          <span className="w-12 text-center font-mono text-sm font-medium text-slate-600 dark:text-slate-300">
            {fontScale}%
          </span>
        </div>
      </div>
    </div>
  )
})

function MobileResetDropdown({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, handleClickOutside])

  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Theme options"
        className="cursor-pointer rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <DotsThreeVertical className="h-5 w-5" weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <button
            onClick={() => {
              onReset()
              setOpen(false)
            }}
            className="w-full cursor-pointer px-3 py-2 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Reset All
          </button>
        </div>
      )}
    </div>
  )
}

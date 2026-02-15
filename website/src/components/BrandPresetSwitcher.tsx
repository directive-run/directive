'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import { Palette } from '@phosphor-icons/react'
import { IconButton } from '@/components/IconButton'

import {
  COLOR_PRESETS,
  TYPO_PRESETS,
  DEFAULT_COLOR_PRESET,
  DEFAULT_TYPO_PRESET,
  applyColorPreset,
  applyTypoPreset,
  applyFontSize,
  clearPresets,
  clearFontSize,
  findColorPreset,
  findTypoPreset,
  type ColorPreset,
  type TypoPreset,
} from '@/lib/brand-presets'
import {
  STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
} from '@/lib/storage-keys'

export const BrandPresetSwitcher = memo(function BrandPresetSwitcher({
  className,
}: {
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [colorId, setColorId] = useState<string>('default')
  const [typoId, setTypoId] = useState<number>(0)
  const [fontScale, setFontScale] = useState<number>(100)
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const firstColorRef = useRef<HTMLButtonElement>(null)
  const activeColorRef = useRef(colorId)

  useEffect(() => {
    setMounted(true)
    const savedColor = safeGetItem(STORAGE_KEYS.COLOR)
    const savedTypo = safeGetItem(STORAGE_KEYS.TYPO)

    if (savedColor) {
      const preset = findColorPreset(savedColor)
      if (preset) {
        setColorId(savedColor)
        activeColorRef.current = savedColor
        applyColorPreset(preset)
      }
    }

    if (savedTypo) {
      const id = parseInt(savedTypo, 10)
      const preset = findTypoPreset(id)
      if (preset) {
        setTypoId(id)
        applyTypoPreset(preset)
      }
    }

    const savedFontSize = safeGetItem(STORAGE_KEYS.FONT_SIZE)
    if (savedFontSize) {
      const scale = parseFloat(savedFontSize)
      if (!isNaN(scale)) {
        setFontScale(scale)
        applyFontSize(scale)
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

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Focus first color button when panel opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => firstColorRef.current?.focus())
    }
  }, [isOpen])

  const handleColorChange = useCallback((preset: ColorPreset) => {
    activeColorRef.current = preset.id
    setColorId(preset.id)
    applyColorPreset(preset)
    safeSetItem(STORAGE_KEYS.COLOR, preset.id)
  }, [])

  const handleTypoChange = useCallback((preset: TypoPreset) => {
    setTypoId(preset.id)
    applyTypoPreset(preset)
    safeSetItem(STORAGE_KEYS.TYPO, String(preset.id))
  }, [])

  const handleFontSizeChange = useCallback((delta: number) => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 10) / 10
      const clamped = Math.max(75, Math.min(150, next))
      applyFontSize(clamped)
      if (clamped === 100) {
        clearFontSize()
        safeRemoveItem(STORAGE_KEYS.FONT_SIZE)
      } else {
        safeSetItem(STORAGE_KEYS.FONT_SIZE, String(clamped))
      }

      return clamped
    })
  }, [])

  const handleReset = useCallback(() => {
    activeColorRef.current = 'default'
    clearPresets()
    setColorId('default')
    setTypoId(0)
    setFontScale(100)
    safeRemoveItem(STORAGE_KEYS.COLOR)
    safeRemoveItem(STORAGE_KEYS.TYPO)
    safeRemoveItem(STORAGE_KEYS.FONT_SIZE)
  }, [])

  // Hover preview — temporarily apply preset, restore on leave
  const handleColorHover = useCallback((preset: ColorPreset) => {
    applyColorPreset(preset)
  }, [])

  const handleColorLeave = useCallback(() => {
    const current = findColorPreset(activeColorRef.current)
    if (current) applyColorPreset(current)
  }, [])

  if (!mounted) {
    return <div className={clsx('h-10 w-10 sm:h-8 sm:w-8', className)} suppressHydrationWarning />
  }

  const allColors = [DEFAULT_COLOR_PRESET, ...COLOR_PRESETS]
  const allTypos = [DEFAULT_TYPO_PRESET, ...TYPO_PRESETS]
  const currentColor = findColorPreset(colorId) ?? DEFAULT_COLOR_PRESET
  const currentTypo = findTypoPreset(typoId) ?? DEFAULT_TYPO_PRESET

  return (
    <div className={clsx('relative', className)} ref={panelRef}>
      <IconButton
        onClick={() => setIsOpen(!isOpen)}
        active={isOpen}
        aria-label="Toggle brand preset switcher"
        aria-expanded={isOpen}
        title="Brand Preset Switcher"
      >
        <Palette className="h-6 w-6 sm:h-5 sm:w-5" weight="duotone" />
      </IconButton>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-3 max-h-[calc(100vh-8rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-white p-4 shadow-md ring-1 shadow-black/5 ring-black/5 dark:bg-slate-800 dark:ring-white/5"
          role="dialog"
          aria-label="Brand presets"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Brand Presets
            </h3>
            <button
              onClick={handleReset}
              className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Reset
            </button>
          </div>

          {/* Current selection info */}
          <div className="mb-4">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
              {currentColor.name}
            </p>
            <p className="text-[10px] text-slate-400">
              {currentColor.primary.name} + {currentColor.accent.name} / {currentTypo.name}
            </p>
            <p className="mt-0.5 text-[10px] italic text-slate-400">
              {currentColor.tagline}
            </p>
          </div>

          {/* Color Combos */}
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Color Combo
            </p>
            <div className="grid grid-cols-4 gap-1.5" onMouseLeave={handleColorLeave}>
              {allColors.map((preset, index) => (
                <button
                  key={preset.id}
                  ref={index === 0 ? firstColorRef : undefined}
                  onClick={() => handleColorChange(preset)}
                  onMouseEnter={() => handleColorHover(preset)}
                  className={clsx(
                    'group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg px-1.5 pt-4 pb-2 transition',
                    colorId === preset.id
                      ? 'bg-slate-100 ring-2 ring-slate-900 dark:bg-slate-700 dark:ring-white'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
                  )}
                  aria-label={`${preset.name}: ${preset.primary.name} + ${preset.accent.name}`}
                  title={`${preset.name}: ${preset.primary.name} + ${preset.accent.name}`}
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
                  <span className="max-w-full truncate text-[9px] font-medium text-slate-500 dark:text-slate-400">
                    {preset.id === 'default' ? 'Def' : preset.id}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Typography */}
          <div className="mt-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Typography
            </p>
            <div className="space-y-1">
              {allTypos.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleTypoChange(preset)}
                  className={clsx(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition',
                    typoId === preset.id
                      ? 'bg-slate-100 font-medium text-slate-900 ring-1 ring-slate-300 dark:bg-slate-700 dark:text-white dark:ring-slate-500'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50',
                  )}
                >
                  <span className="w-4 flex-none text-center font-mono text-[10px] text-slate-400">
                    {preset.id === 0 ? '-' : preset.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{preset.name}</span>
                    <span className="block truncate text-[10px] text-slate-400">
                      {preset.display.name} + {preset.body.name}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Text Size */}
          <div className="mt-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Text Size
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => handleFontSizeChange(-12.5)}
                disabled={fontScale <= 75}
                className={clsx(
                  'flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-lg text-sm font-bold transition',
                  fontScale <= 75
                    ? 'cursor-not-allowed bg-slate-100 text-slate-300 dark:bg-slate-700 dark:text-slate-600'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600',
                )}
                aria-label="Decrease text size"
              >
                &minus;
              </button>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                {fontScale}%
              </span>
              <button
                onClick={() => handleFontSizeChange(12.5)}
                disabled={fontScale >= 150}
                className={clsx(
                  'flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-lg text-sm font-bold transition',
                  fontScale >= 150
                    ? 'cursor-not-allowed bg-slate-100 text-slate-300 dark:bg-slate-700 dark:text-slate-600'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600',
                )}
                aria-label="Increase text size"
              >
                +
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  )
})

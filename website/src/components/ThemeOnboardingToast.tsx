'use client'

import { useCallback, useEffect, useState } from 'react'
import { Palette, X } from '@phosphor-icons/react'
import { findColorPreset } from '@/lib/brand-presets'
import { STORAGE_KEYS, safeGetItem, safeSetItem, safeRemoveItem } from '@/lib/storage-keys'

const SHOW_DELAY = 2000
const AUTO_DISMISS_DELAY = 8000

export function ThemeOnboardingToast() {
  const [visible, setVisible] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [exiting, setExiting] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)

    const isFirstVisit = safeGetItem(STORAGE_KEYS.FIRST_VISIT)
    const alreadyOnboarded = safeGetItem(STORAGE_KEYS.ONBOARDED)
    if (!isFirstVisit || alreadyOnboarded) return

    const colorId = safeGetItem(STORAGE_KEYS.COLOR)
    if (!colorId) return

    const preset = findColorPreset(colorId)
    if (!preset) return

    setPresetName(preset.name)

    const showTimer = setTimeout(() => setVisible(true), SHOW_DELAY)
    const dismissTimer = setTimeout(() => dismiss(), SHOW_DELAY + AUTO_DISMISS_DELAY)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(dismissTimer)
    }
  }, [])

  const dismiss = useCallback(() => {
    setExiting(true)
    const delay = reducedMotion ? 0 : 300
    setTimeout(() => {
      setVisible(false)
      setExiting(false)
      safeSetItem(STORAGE_KEYS.ONBOARDED, '1')
      safeRemoveItem(STORAGE_KEYS.FIRST_VISIT)
    }, delay)
  }, [reducedMotion])

  const handleVote = useCallback(() => {
    dismiss()
    const switcher = document.querySelector('[aria-label="Toggle brand preset switcher"]')
    if (switcher instanceof HTMLElement) {
      switcher.click()
      setTimeout(() => {
        const voteSection = document.getElementById('cast-your-vote')
        voteSection?.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'nearest',
        })
      }, 200)
    }
  }, [dismiss, reducedMotion])

  if (!visible) return null

  return (
    <div
      className={`fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-black/5 dark:bg-brand-surface-raised dark:ring-white/10 ${
        reducedMotion
          ? exiting
            ? 'opacity-0'
            : 'opacity-100'
          : `transition-all duration-300 ${exiting ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`
      }`}
      role="status"
      aria-live="polite"
    >
      {/* Palette icon */}
      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-primary/10">
        <Palette weight="duotone" className="h-4 w-4 text-brand-primary" />
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          You got &ldquo;{presetName}&rdquo;
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Like it? Help us choose the default.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleVote}
            className="rounded-md bg-brand-primary px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-primary/90"
          >
            Vote
          </button>
          <button
            onClick={dismiss}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Close button */}
      <button
        onClick={dismiss}
        className="flex-none text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

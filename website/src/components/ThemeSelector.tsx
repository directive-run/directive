'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { Sun, Moon, Monitor } from '@phosphor-icons/react'
import clsx from 'clsx'

import { useExperiment } from '@/lib/useExperiment'

/* ── Phosphor icons ── */

function PhosphorLightIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return <Sun weight="duotone" aria-hidden="true" {...props} />
}

function PhosphorDarkIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return <Moon weight="duotone" aria-hidden="true" {...props} />
}

function PhosphorSystemIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return <Monitor weight="duotone" aria-hidden="true" {...props} />
}

/* ── Custom SVG icons ── */

function CustomLightIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 1a1 1 0 0 1 2 0v1a1 1 0 1 1-2 0V1Zm4 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm2.657-5.657a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414Zm-1.415 11.313-.707-.707a1 1 0 0 1 1.415-1.415l.707.708a1 1 0 0 1-1.415 1.414ZM16 7.999a1 1 0 0 0-1-1h-1a1 1 0 1 0 0 2h1a1 1 0 0 0 1-1ZM7 14a1 1 0 1 1 2 0v1a1 1 0 1 1-2 0v-1Zm-2.536-2.464a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414Zm0-8.486A1 1 0 0 1 3.05 4.464l-.707-.707a1 1 0 0 1 1.414-1.414l.707.707ZM3 8a1 1 0 0 0-1-1H1a1 1 0 0 0 0 2h1a1 1 0 0 0 1-1Z"
      />
    </svg>
  )
}

function CustomDarkIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.23 3.333C7.757 2.905 7.68 2 7 2a6 6 0 1 0 0 12c.68 0 .758-.905.23-1.332A5.989 5.989 0 0 1 5 8c0-1.885.87-3.568 2.23-4.668ZM12 5a1 1 0 0 1 1 1 1 1 0 0 0 1 1 1 1 0 1 1 0 2 1 1 0 0 0-1 1 1 1 0 1 1-2 0 1 1 0 0 0-1-1 1 1 0 1 1 0-2 1 1 0 0 0 1-1 1 1 0 0 1 1-1Z"
      />
    </svg>
  )
}

function CustomSystemIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-1.5l.31 1.242c.084.333.36.573.63.808.091.08.182.158.264.24A1 1 0 0 1 11 15H5a1 1 0 0 1-.704-1.71c.082-.082.173-.16.264-.24.27-.235.546-.475.63-.808L5.5 11H4a3 3 0 0 1-3-3V4Zm3-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4Z"
      />
    </svg>
  )
}

const phosphorIcons = { light: PhosphorLightIcon, dark: PhosphorDarkIcon, system: PhosphorSystemIcon }
const customIcons = { light: CustomLightIcon, dark: CustomDarkIcon, system: CustomSystemIcon }

function useThemeIcons() {
  const variant = useExperiment('theme-icons', 'custom-svg')

  return variant === 'phosphor' ? phosphorIcons : customIcons
}

// All icons use currentColor, so text-* classes control color for both
// custom SVGs (fill="currentColor") and Phosphor (uses currentColor internally).
const iconColors = {
  toggleActive: 'text-brand-primary dark:text-brand-primary-400',
  toggleInactive: 'text-current',
  selectorActive: 'text-brand-primary-400',
  selectorInactive: 'text-slate-400',
  buttonLight: 'text-brand-primary',
  buttonLightSystem: 'text-slate-500',
  buttonDark: 'text-brand-primary-400',
  buttonDarkSystem: 'text-slate-300',
} as const

const themes = [
  { name: 'Light', value: 'light' },
  { name: 'Dark', value: 'dark' },
  { name: 'System', value: 'system' },
]

const themeToggleOrder = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeToggle() {
  let { theme, setTheme } = useTheme()
  let [mounted, setMounted] = useState(false)
  const icons = useThemeIcons()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-8 w-24" />
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
      {themeToggleOrder.map((option) => {
        const Icon = icons[option.value as keyof typeof icons]

        return (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            aria-label={option.label}
            className={clsx(
              'cursor-pointer rounded-full p-1.5 transition-colors',
              theme === option.value
                ? 'bg-white shadow-sm dark:bg-slate-700'
                : 'text-slate-400 hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400',
            )}
          >
            <Icon
              className={clsx(
                'h-4 w-4',
                theme === option.value
                  ? iconColors.toggleActive
                  : iconColors.toggleInactive,
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

export function ThemeSelector(
  props: React.ComponentPropsWithoutRef<typeof Listbox<'div'>>,
) {
  let { theme, setTheme } = useTheme()
  let [mounted, setMounted] = useState(false)
  const icons = useThemeIcons()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-10 w-10 sm:h-6 sm:w-6" suppressHydrationWarning />
  }

  const LightIcon = icons.light
  const DarkIcon = icons.dark

  return (
    <Listbox as="div" value={theme} onChange={setTheme} {...props}>
      <Label className="sr-only">Theme</Label>
      <ListboxButton
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-md ring-1 shadow-black/5 ring-black/5 sm:h-6 sm:w-6 dark:bg-slate-600 dark:ring-brand-primary/50"
        aria-label="Theme"
      >
        <LightIcon
          className={clsx(
            'h-4 w-4 dark:hidden',
            theme === 'system' ? iconColors.buttonLightSystem : iconColors.buttonLight,
          )}
        />
        <DarkIcon
          className={clsx(
            'hidden h-4 w-4 dark:block',
            theme === 'system' ? iconColors.buttonDarkSystem : iconColors.buttonDark,
          )}
        />
      </ListboxButton>
      <ListboxOptions className="absolute top-full left-1/2 mt-3 w-36 -translate-x-1/2 space-y-1 rounded-xl bg-white p-3 text-sm font-medium shadow-md ring-1 shadow-black/5 ring-black/5 dark:bg-slate-800 dark:ring-white/5">
        {themes.map((t) => {
          const Icon = icons[t.value as keyof typeof icons]

          return (
            <ListboxOption
              key={t.value}
              value={t.value}
              className={({ focus, selected }) =>
                clsx(
                  'flex cursor-pointer items-center rounded-[0.625rem] p-1 select-none',
                  {
                    'text-brand-primary': selected,
                    'text-slate-900 dark:text-white': focus && !selected,
                    'text-slate-700 dark:text-slate-400': !focus && !selected,
                    'bg-slate-100 dark:bg-slate-900/40': focus,
                  },
                )
              }
            >
              {({ selected }) => (
                <>
                  <div className="rounded-md bg-white p-1 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-700 dark:ring-white/5 dark:ring-inset">
                    <Icon
                      className={clsx(
                        'h-4 w-4',
                        selected
                          ? iconColors.selectorActive
                          : iconColors.selectorInactive,
                      )}
                    />
                  </div>
                  <div className="ml-3">{t.name}</div>
                </>
              )}
            </ListboxOption>
          )
        })}
      </ListboxOptions>
    </Listbox>
  )
}

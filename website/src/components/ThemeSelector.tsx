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

function LightIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return <Sun weight="duotone" aria-hidden="true" {...props} />
}

function DarkIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return <Moon weight="duotone" aria-hidden="true" {...props} />
}

function SystemIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return <Monitor weight="duotone" aria-hidden="true" {...props} />
}

const icons = { light: LightIcon, dark: DarkIcon, system: SystemIcon }

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

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-10 w-10 sm:h-6 sm:w-6" suppressHydrationWarning />
  }

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

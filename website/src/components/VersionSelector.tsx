'use client'

import { Fragment, memo } from 'react'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react'
import clsx from 'clsx'

interface Version {
  value: string
  label: string
  status?: 'current' | 'latest' | 'deprecated'
}

const VERSIONS: Version[] = [
  { value: 'v2', label: 'v2.x (Latest)', status: 'latest' },
  { value: 'v1', label: 'v1.x', status: 'current' },
  { value: 'v0', label: 'v0.x (Deprecated)', status: 'deprecated' },
]

function ChevronUpDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

export const VersionSelector = memo(function VersionSelector({
  className,
}: {
  className?: string
}) {
  // For now, default to latest version
  // In a real implementation, this would be tied to routing
  const selectedVersion = VERSIONS[0]

  const handleVersionChange = (version: Version) => {
    // In a real implementation, this would navigate to the versioned docs
    // For now, just show what would happen
    if (version.value !== selectedVersion.value) {
      // Could use router.push(`/docs/${version.value}/...`)
      console.log(`Switching to ${version.label}`)
    }
  }

  return (
    <Listbox value={selectedVersion} onChange={handleVersionChange}>
      <div className={clsx('relative', className)}>
        <ListboxButton className="relative w-full cursor-pointer rounded-lg bg-white py-2 pl-3 pr-10 text-left text-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary dark:bg-slate-800 dark:ring-slate-700">
          <span className="flex items-center gap-2">
            <span className="block truncate font-medium text-slate-900 dark:text-white">
              {selectedVersion.label}
            </span>
            {selectedVersion.status === 'latest' && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                Latest
              </span>
            )}
            {selectedVersion.status === 'deprecated' && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                Deprecated
              </span>
            )}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-slate-400" />
          </span>
        </ListboxButton>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <ListboxOptions className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm dark:bg-slate-800 dark:ring-white/5">
            {VERSIONS.map((version) => (
              <ListboxOption
                key={version.value}
                value={version}
                className={({ focus }) =>
                  clsx(
                    'relative cursor-pointer select-none py-2 pl-10 pr-4',
                    focus ? 'bg-brand-primary-100 text-brand-primary-900 dark:bg-brand-primary-900 dark:text-brand-primary-100' : 'text-slate-900 dark:text-slate-100'
                  )
                }
              >
                {({ selected }) => (
                  <>
                    <span className={clsx('flex items-center gap-2', selected ? 'font-medium' : 'font-normal')}>
                      {version.label}
                      {version.status === 'latest' && (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                          Latest
                        </span>
                      )}
                      {version.status === 'deprecated' && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          Deprecated
                        </span>
                      )}
                    </span>
                    {selected && (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-brand-primary-600 dark:text-brand-primary-400">
                        <CheckIcon className="h-5 w-5" />
                      </span>
                    )}
                  </>
                )}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </Transition>
      </div>
    </Listbox>
  )
})

// Version banner for deprecated/old versions
export const VersionBanner = memo(function VersionBanner({
  version,
  latestVersion = 'v2',
}: {
  version: string
  latestVersion?: string
}) {
  if (version === latestVersion) return null

  const isDeprecated = version === 'v0'

  return (
    <div
      className={clsx(
        'mb-6 rounded-lg border p-4',
        isDeprecated
          ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
          : 'border-brand-primary-200 bg-brand-primary-50 dark:border-brand-primary-800 dark:bg-brand-primary-900/20'
      )}
    >
      <div className="flex items-start gap-3">
        <svg
          className={clsx(
            'mt-0.5 h-5 w-5 flex-shrink-0',
            isDeprecated ? 'text-amber-500' : 'text-brand-primary'
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
        <div className="flex-1">
          <h4
            className={clsx(
              'text-sm font-semibold',
              isDeprecated ? 'text-amber-800 dark:text-amber-200' : 'text-brand-primary-800 dark:text-brand-primary-200'
            )}
          >
            {isDeprecated ? 'Deprecated Version' : 'Older Version'}
          </h4>
          <p
            className={clsx(
              'mt-1 text-sm',
              isDeprecated ? 'text-amber-700 dark:text-amber-300' : 'text-brand-primary-700 dark:text-brand-primary-300'
            )}
          >
            You are viewing documentation for {version}.{' '}
            {isDeprecated
              ? 'This version is deprecated and no longer maintained.'
              : 'A newer version is available.'}{' '}
            <a
              href={`/docs`}
              className={clsx(
                'font-medium underline',
                isDeprecated
                  ? 'text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100'
                  : 'text-brand-primary-800 hover:text-brand-primary-900 dark:text-brand-primary-200 dark:hover:text-brand-primary-100'
              )}
            >
              View {latestVersion} documentation
            </a>
          </p>
        </div>
      </div>
    </div>
  )
})

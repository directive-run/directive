'use client'

import { memo, useState } from 'react'
import clsx from 'clsx'

interface PlaygroundProps {
  projectId?: string
  title?: string
  file?: string
  height?: number
  view?: 'editor' | 'preview' | 'both'
}

const EXAMPLES = {
  counter: {
    title: 'Counter Example',
    projectId: 'directive-counter-example',
    file: 'src/main.ts',
  },
  'data-fetching': {
    title: 'Data Fetching',
    projectId: 'directive-data-fetching',
    file: 'src/main.ts',
  },
  'form-validation': {
    title: 'Form Validation',
    projectId: 'directive-form-validation',
    file: 'src/main.ts',
  },
} as const

type ExampleKey = keyof typeof EXAMPLES

function PlaygroundTabs({
  activeExample,
  onChange,
}: {
  activeExample: ExampleKey
  onChange: (example: ExampleKey) => void
}) {
  return (
    <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
      {(Object.keys(EXAMPLES) as ExampleKey[]).map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition',
            activeExample === key
              ? 'bg-sky-500 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          )}
        >
          {EXAMPLES[key].title}
        </button>
      ))}
    </div>
  )
}

function StackBlitzEmbed({
  projectId,
  file,
  height = 500,
  view = 'both',
}: {
  projectId: string
  file: string
  height: number
  view: 'editor' | 'preview' | 'both'
}) {
  // Using StackBlitz SDK embed URL format
  const embedUrl = `https://stackblitz.com/edit/${projectId}?embed=1&file=${encodeURIComponent(file)}&view=${view}&hideNavigation=1&hideDevTools=1`

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <iframe
        src={embedUrl}
        className="w-full"
        style={{ height: `${height}px` }}
        title="Interactive Playground"
        allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
        loading="lazy"
      />
    </div>
  )
}

function FallbackEditor({
  code,
  height = 400,
}: {
  code: string
  height: number
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
          Interactive Playground
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="rounded-md bg-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
          <a
            href="https://stackblitz.com/fork/directive-starter"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-sky-500 px-3 py-1 text-xs text-white transition hover:bg-sky-600"
          >
            Open in StackBlitz
          </a>
        </div>
      </div>
      <pre
        className="overflow-auto bg-slate-900 p-4 text-sm text-slate-100"
        style={{ height: `${height}px` }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

const STARTER_CODE = `import { createModule, createSystem, t } from 'directive';

// Define your module
const counterModule = createModule("counter", {
  schema: {
    facts: {
      count: t.number(),
    },
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
    isEven: (facts) => facts.count % 2 === 0,
  },
});

// Create the system
const system = createSystem({ module: counterModule });

// Use it
console.log(system.facts.count);      // 0
console.log(system.derive.doubled);   // 0

system.facts.count = 5;

console.log(system.facts.count);      // 5
console.log(system.derive.doubled);   // 10
console.log(system.derive.isEven);    // false
`

export const Playground = memo(function Playground({
  projectId,
  title,
  file = 'src/main.ts',
  height = 500,
  view = 'both',
}: PlaygroundProps) {
  const [activeExample, setActiveExample] = useState<ExampleKey>('counter')
  const [useStackBlitz, setUseStackBlitz] = useState(true)

  // If a specific projectId is provided, use that directly
  if (projectId) {
    return (
      <div className="my-8">
        {title && (
          <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            {title}
          </h3>
        )}
        <StackBlitzEmbed
          projectId={projectId}
          file={file}
          height={height}
          view={view}
        />
      </div>
    )
  }

  // Otherwise, show the example picker with fallback
  return (
    <div className="my-8">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          Try Directive
        </h3>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={useStackBlitz}
            onChange={(e) => setUseStackBlitz(e.target.checked)}
            className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
          />
          Use StackBlitz
        </label>
      </div>

      {useStackBlitz ? (
        <>
          <PlaygroundTabs
            activeExample={activeExample}
            onChange={setActiveExample}
          />
          <div className="mt-4">
            <StackBlitzEmbed
              projectId={EXAMPLES[activeExample].projectId}
              file={EXAMPLES[activeExample].file}
              height={height}
              view={view}
            />
          </div>
        </>
      ) : (
        <FallbackEditor code={STARTER_CODE} height={height - 100} />
      )}
    </div>
  )
})

// Export a simple embed component for docs
export const StackBlitzButton = memo(function StackBlitzButton({
  projectId = 'directive-starter',
  text = 'Open in StackBlitz',
}: {
  projectId?: string
  text?: string
}) {
  return (
    <a
      href={`https://stackblitz.com/fork/${projectId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
    >
      <svg className="h-4 w-4" viewBox="0 0 28 28" fill="currentColor">
        <path d="M12.747 16.273h-7.46L18.925 1.5l-3.671 10.227h7.46L9.075 26.5l3.672-10.227z" />
      </svg>
      {text}
    </a>
  )
})

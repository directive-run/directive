'use client'

import { Fragment, useState } from 'react'
import clsx from 'clsx'
import { Highlight } from 'prism-react-renderer'

import { CopyButton } from './CodeTabs'
import { useCodeTheme } from '@/lib/useCodeTheme'

export interface CodeEditorTab {
  filename: string
  code: string
  language: string
}

interface CodeEditorProps {
  tabs: CodeEditorTab[]
  className?: string
  showLineNumbers?: boolean
  showTrafficLights?: boolean
}

function TrafficLightsIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 10" fill="none" {...props}>
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="21" cy="5" r="4.5" />
      <circle cx="37" cy="5" r="4.5" />
    </svg>
  )
}

function getContainerClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg'
  }

  if (codeTheme === 'dark') {
    return 'relative rounded-2xl bg-[#0A101F]/80 ring-1 ring-white/10 backdrop-blur-sm'
  }

  return 'relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg dark:bg-[#0A101F]/80 dark:ring-white/10 dark:shadow-none dark:backdrop-blur-sm'
}

function getTrafficLightsClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'h-2.5 w-auto stroke-slate-300'
  }

  if (codeTheme === 'dark') {
    return 'h-2.5 w-auto stroke-slate-500/30'
  }

  return 'h-2.5 w-auto stroke-slate-300 dark:stroke-slate-500/30'
}

function getTabBarClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'flex border-b border-slate-200'
  }

  if (codeTheme === 'dark') {
    return 'flex border-b border-slate-700/50'
  }

  return 'flex border-b border-slate-200 dark:border-slate-700/50'
}

function getTabClasses(codeTheme: string, isActive: boolean): string {
  const base = 'cursor-pointer px-4 pt-3 pb-2 font-mono text-xs transition-colors'

  if (isActive) {
    if (codeTheme === 'light') {
      return `${base} border-b-2 border-brand-primary text-slate-800`
    }

    if (codeTheme === 'dark') {
      return `${base} border-b-2 border-brand-primary text-slate-200`
    }

    return `${base} border-b-2 border-brand-primary text-slate-800 dark:text-slate-200`
  }

  if (codeTheme === 'light') {
    return `${base} text-slate-400 hover:text-slate-600`
  }

  if (codeTheme === 'dark') {
    return `${base} text-slate-500 hover:text-slate-400`
  }

  return `${base} text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-400`
}

function getLineNumberClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'border-r border-slate-200 pr-4 font-mono text-slate-400 select-none'
  }

  if (codeTheme === 'dark') {
    return 'border-r border-slate-300/5 pr-4 font-mono text-slate-600 select-none'
  }

  return 'border-r border-slate-200 pr-4 font-mono text-slate-400 select-none dark:border-slate-300/5 dark:text-slate-600'
}

export function CodeEditor({
  tabs,
  className,
  showLineNumbers = true,
  showTrafficLights = true,
}: CodeEditorProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const codeTheme = useCodeTheme()

  if (tabs.length === 0) {
    return null
  }

  const activeTab = tabs[activeIndex] ?? tabs[0]
  const code = activeTab.code.trimEnd()
  const lines = code.split('\n')

  return (
    <div
      className={clsx(getContainerClasses(codeTheme), className)}
      data-code-theme={codeTheme !== 'auto' ? codeTheme : undefined}
    >
      <div className="pt-4 pl-4">
        {showTrafficLights && (
          <TrafficLightsIcon className={getTrafficLightsClasses(codeTheme)} />
        )}

        {/* Tab bar */}
        <div className={clsx('mt-4 -ml-4', getTabBarClasses(codeTheme))}>
          {tabs.map((tab, i) => (
            <button
              key={tab.filename}
              onClick={() => setActiveIndex(i)}
              className={getTabClasses(codeTheme, i === activeIndex)}
            >
              {tab.filename}
            </button>
          ))}
        </div>
      </div>

      {/* Code area */}
      <div className="relative">
        <CopyButton code={code} codeTheme={codeTheme} />
        <div className="flex items-start px-1 pt-4 text-sm">
          {showLineNumbers && (
            <div
              aria-hidden="true"
              className={getLineNumberClasses(codeTheme)}
            >
              {lines.map((_, index) => (
                <Fragment key={index}>
                  {(index + 1).toString().padStart(2, '0')}
                  <br />
                </Fragment>
              ))}
            </div>
          )}

          <Highlight
            code={code}
            language={activeTab.language || 'text'}
            theme={{ plain: {}, styles: [] }}
          >
            {({ className: highlightClass, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={clsx(highlightClass, 'flex overflow-x-auto pb-6')}
                style={style}
              >
                <code className="px-4">
                  {tokens.map((line, lineIndex) => (
                    <div key={lineIndex} {...getLineProps({ line })}>
                      {line.map((token, tokenIndex) => (
                        <span
                          key={tokenIndex}
                          {...getTokenProps({ token })}
                        />
                      ))}
                    </div>
                  ))}
                </code>
              </pre>
            )}
          </Highlight>
        </div>
      </div>
    </div>
  )
}

'use client'

import { Fragment, memo, useCallback, useState } from 'react'
import { Highlight } from 'prism-react-renderer'
import { Check, Copy } from '@phosphor-icons/react'
import { useCodeTheme } from '@/lib/useCodeTheme'

export interface CodeTab {
  filename: string
  label?: string
  code: string
  language: string
}

interface CodeTabsProps {
  tabs: CodeTab[]
}

export const CopyButton = memo(function CopyButton({
  code,
  codeTheme = 'auto',
}: {
  code: string
  codeTheme?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err instanceof Error ? err.message : 'Unknown error')
    }
  }, [code])

  const baseClasses = 'cursor-pointer absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-xs opacity-50 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary'

  let themeClasses: string
  if (codeTheme === 'light') {
    themeClasses = 'bg-black/5 text-slate-500 hover:bg-black/10 hover:text-slate-700'
  } else if (codeTheme === 'dark') {
    themeClasses = 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300'
  } else {
    themeClasses = 'bg-black/5 text-slate-500 hover:bg-black/10 hover:text-slate-700 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-300'
  }

  return (
    <button
      onClick={handleCopy}
      className={`${baseClasses} ${themeClasses}`}
      aria-label={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3" weight="bold" />
          Copied
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Copy className="h-3 w-3" />
          Copy
        </span>
      )}
    </button>
  )
})

function getContainerClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'group relative overflow-hidden rounded-xl bg-slate-50 shadow-lg ring-1 ring-slate-200'
  }

  if (codeTheme === 'dark') {
    return 'group relative overflow-hidden rounded-xl bg-brand-code-bg shadow-lg ring-1 ring-slate-300/10'
  }

  return 'group relative overflow-hidden rounded-xl bg-slate-50 shadow-lg ring-1 ring-slate-200 dark:bg-brand-code-bg dark:ring-slate-300/10'
}

function getTitleBarClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'border-b border-slate-200 px-5 pt-3 pb-2 font-mono text-xs text-slate-500'
  }

  if (codeTheme === 'dark') {
    return 'border-b border-slate-700/50 px-5 pt-3 pb-2 font-mono text-xs text-slate-400'
  }

  return 'border-b border-slate-200 px-5 pt-3 pb-2 font-mono text-xs text-slate-500 dark:border-slate-700/50 dark:text-slate-400'
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

function getLineCountClasses(codeTheme: string): string {
  if (codeTheme === 'light') {
    return 'ml-1.5 text-slate-400'
  }

  if (codeTheme === 'dark') {
    return 'ml-1.5 text-slate-600'
  }

  return 'ml-1.5 text-slate-400 dark:text-slate-600'
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  codeTheme = 'auto',
}: {
  code: string
  language: string
  codeTheme?: string
}) {
  const trimmed = code.trimEnd()

  return (
    <>
      <CopyButton code={trimmed} codeTheme={codeTheme} />
      <Highlight
        code={trimmed}
        language={language || 'text'}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={`${className} overflow-x-auto p-5 text-[0.875em] leading-7`}
            style={style}
          >
            <code>
              {tokens.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {line
                    .filter((token) => !token.empty)
                    .map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  {'\n'}
                </Fragment>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </>
  )
})

export const CodeTabs = memo(function CodeTabs({ tabs }: CodeTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const codeTheme = useCodeTheme()

  if (tabs.length === 0) {
    return null
  }

  const activeTab = tabs[activeIndex] ?? tabs[0]
  const isSingle = tabs.length === 1

  return (
    <div
      className={getContainerClasses(codeTheme)}
      data-code-theme={codeTheme !== 'auto' ? codeTheme : undefined}
    >
      {/* Header: single title or tab bar */}
      {isSingle ? (
        <div className={getTitleBarClasses(codeTheme)}>
          {activeTab.filename}
        </div>
      ) : (
        <div className={getTabBarClasses(codeTheme)} data-testid="code-tabs-bar">
          {tabs.map((tab, i) => {
            const isActive = i === activeIndex
            const lines = tab.code.trimEnd().split('\n').length

            return (
              <button
                key={tab.filename}
                onClick={() => setActiveIndex(i)}
                className={getTabClasses(codeTheme, isActive)}
              >
                {tab.filename}
                <span className={getLineCountClasses(codeTheme)}>
                  ({lines})
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Code block */}
      <CodeBlock code={activeTab.code} language={activeTab.language} codeTheme={codeTheme} />
    </div>
  )
})

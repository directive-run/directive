'use client'

import { Fragment, memo } from 'react'
import { Highlight } from 'prism-react-renderer'
import { CopyButton } from './CodeTabs'
import { useCodeTheme } from '@/lib/useCodeTheme'

function getWrapperClasses(codeTheme: string, hasTitle: boolean): string {
  if (!hasTitle) {
    return 'group relative'
  }

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

export const Fence = memo(function Fence({
  children,
  language,
  title,
}: {
  children: string
  language: string
  title?: string
}) {
  const codeTheme = useCodeTheme()
  const code = children.trimEnd()

  return (
    <div
      className={getWrapperClasses(codeTheme, !!title)}
      data-code-theme={codeTheme !== 'auto' ? codeTheme : undefined}
    >
      {title && (
        <div className={getTitleBarClasses(codeTheme)}>
          {title}
        </div>
      )}
      <CopyButton code={code} codeTheme={codeTheme} />
      <Highlight
        code={code}
        language={language || 'text'}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={
              title
                ? `${className} overflow-x-auto p-5 text-[0.875em] leading-7`
                : className
            }
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
    </div>
  )
})

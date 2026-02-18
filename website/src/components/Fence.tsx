'use client'

import { Fragment, memo } from 'react'
import { Highlight } from 'prism-react-renderer'
import { CopyButton } from './CodeTabs'

export const Fence = memo(function Fence({
  children,
  language,
  title,
}: {
  children: string
  language: string
  title?: string
}) {
  const code = children.trimEnd()

  return (
    <div
      className={title ? 'group relative overflow-hidden rounded-xl' : 'group relative'}
      style={title ? {
        backgroundColor: 'var(--code-bg)',
        boxShadow: '0 0 0 1px var(--code-ring), var(--code-shadow)',
      } : undefined}
    >
      {title && (
        <div
          className="border-b px-5 pt-3 pb-2 font-mono text-xs"
          style={{ borderColor: 'var(--code-title-border)', color: 'var(--code-title-text)' }}
        >
          {title}
        </div>
      )}
      <CopyButton code={code} />
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

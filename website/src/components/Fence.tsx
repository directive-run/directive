'use client'

import { Fragment, memo, useCallback, useState } from 'react'
import { Highlight } from 'prism-react-renderer'
import { Check, Copy } from '@phosphor-icons/react'

const CopyButton = memo(function CopyButton({ code }: { code: string }) {
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

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 z-10 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-400 opacity-50 transition hover:bg-white/10 hover:text-slate-300 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
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

export const Fence = memo(function Fence({
  children,
  language,
}: {
  children: string
  language: string
}) {
  const code = children.trimEnd()

  return (
    <div className="group relative">
      <CopyButton code={code} />
      <Highlight
        code={code}
        language={language || 'text'}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre className={className} style={style}>
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

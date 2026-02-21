'use client'

import { memo } from 'react'
import { Highlight } from 'prism-react-renderer'

// ---------------------------------------------------------------------------
// Lightweight Markdown Renderer (shared between AIChatWidget & InlineChat)
// ---------------------------------------------------------------------------
// Intentionally inline rather than pulling in react-markdown + rehype-highlight.
// Only renders the subset of markdown that the AI chatbot produces (code blocks,
// bold, italic, inline code, links, lists, tables, headings).

/** Fenced code block with Prism syntax highlighting */
const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}) {
  return (
    <Highlight code={code.trimEnd()} language={language || 'typescript'} theme={{ plain: {}, styles: [] }}>
      {({ className, style, tokens, getTokenProps }) => (
        <pre
          className={`${className} my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs`}
          style={style}
        >
          <code>
            {tokens.map((line, lineIndex) => (
              <span key={lineIndex}>
                {line
                  .filter((token) => !token.empty)
                  .map((token, tokenIndex) => (
                    <span key={tokenIndex} {...getTokenProps({ token })} />
                  ))}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  )
})

/** Process inline markdown: bold, inline code, links */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Pattern matches: **bold**, *italic*, `code`, [text](url)
  const inlinePattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      nodes.push(
        <strong key={match.index} className="font-semibold">
          {match[2]}
        </strong>,
      )
    } else if (match[3]) {
      nodes.push(
        <em key={match.index}>
          {match[3]}
        </em>,
      )
    } else if (match[4]) {
      nodes.push(
        <code
          key={match.index}
          className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-600"
        >
          {match[4]}
        </code>,
      )
    } else if (match[5] && match[6]) {
      const href = match[6]
      const isSafe = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/')
      if (isSafe) {
        nodes.push(
          <a
            key={match.index}
            href={href}
            className="text-brand-primary underline hover:text-brand-primary-600"
            target={href.startsWith('http') ? '_blank' : undefined}
            rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {match[5]}
          </a>,
        )
      } else {
        nodes.push(match[0])
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}

/** Render markdown content from assistant messages */
export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  const elements: React.ReactNode[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <CodeBlock key={`code-${elements.length}`} code={codeLines.join('\n')} language={lang} />,
      )
      continue
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h-${elements.length}`} className="mt-3 mb-1 text-xs font-bold">
          {renderInlineMarkdown(line.slice(4))}
        </h4>,
      )
      i++
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h-${elements.length}`} className="mt-3 mb-1 text-sm font-bold">
          {renderInlineMarkdown(line.slice(3))}
        </h3>,
      )
      i++
      continue
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h-${elements.length}`} className="mt-3 mb-1 text-base font-bold">
          {renderInlineMarkdown(line.slice(2))}
        </h2>,
      )
      i++
      continue
    }

    // Unordered list item
    if (line.match(/^[-*]\s/)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push(
          <li key={`li-${items.length}`}>
            {renderInlineMarkdown(lines[i].replace(/^[-*]\s/, ''))}
          </li>,
        )
        i++
      }
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-1 list-disc pl-4 text-sm">
          {items}
        </ul>,
      )
      continue
    }

    // Ordered list item
    if (line.match(/^\d+\.\s/)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(
          <li key={`li-${items.length}`}>
            {renderInlineMarkdown(lines[i].replace(/^\d+\.\s/, ''))}
          </li>,
        )
        i++
      }
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-1 list-decimal pl-4 text-sm">
          {items}
        </ol>,
      )
      continue
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const cells = lines[i]
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
        if (!cells.every((c) => /^[-:]+$/.test(c))) {
          tableRows.push(cells)
        }
        i++
      }
      if (tableRows.length > 0) {
        elements.push(
          <div key={`table-${elements.length}`} className="my-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {tableRows[0].map((cell, ci) => (
                    <th
                      key={ci}
                      className="border-b border-slate-300 px-2 py-1 text-left font-semibold dark:border-slate-600"
                    >
                      {renderInlineMarkdown(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(1).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border-b border-slate-200 px-2 py-1 dark:border-slate-700">
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
      }
      continue
    }

    // Empty line
    if (!line.trim()) {
      i++
      continue
    }

    // Paragraph
    elements.push(
      <p key={`p-${elements.length}`} className="my-1 text-sm">
        {renderInlineMarkdown(line)}
      </p>,
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
})

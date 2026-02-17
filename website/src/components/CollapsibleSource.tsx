'use client'

import { memo, useId, useState } from 'react'
import { CaretDown, CaretRight, Code } from '@phosphor-icons/react'

import { Fence } from '@/components/Fence'

export const CollapsibleSource = memo(function CollapsibleSource({
  title,
  code,
  language,
}: {
  title: string
  code: string
  language: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
      >
        {open ? (
          <CaretDown className="h-4 w-4" weight="bold" />
        ) : (
          <CaretRight className="h-4 w-4" weight="bold" />
        )}
        <Code className="h-4 w-4" />
        {title}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          className="border-t border-slate-200 dark:border-slate-700"
        >
          <Fence language={language}>{code}</Fence>
        </div>
      )}
    </div>
  )
})

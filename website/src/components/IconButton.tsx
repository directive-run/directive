'use client'

import { forwardRef } from 'react'
import clsx from 'clsx'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  children: React.ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ active = false, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          'flex h-10 w-10 cursor-pointer items-center justify-center rounded-full transition-colors sm:h-8 sm:w-8',
          active
            ? 'bg-brand-primary text-white shadow-sm dark:bg-brand-primary-400 dark:text-slate-900'
            : 'bg-slate-100 text-brand-primary hover:bg-slate-200 dark:bg-slate-800 dark:text-brand-primary-400 dark:hover:bg-slate-700',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)

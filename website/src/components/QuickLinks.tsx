import { Icon } from '@/components/Icon'
import { CardLink } from '@/components/CardLink'

export function QuickLinks({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose my-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
      {children}
    </div>
  )
}

export function QuickLink({
  title,
  description,
  href,
  icon,
}: {
  title: string
  description: string
  href: string
  icon: React.ComponentProps<typeof Icon>['icon']
}) {
  return (
    <CardLink href={href} className="p-6">
      <Icon icon={icon} className="h-8 w-8" />
      <h2 className="mt-4 font-display text-base text-slate-900 dark:text-white">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-400">
        {description}
      </p>
    </CardLink>
  )
}

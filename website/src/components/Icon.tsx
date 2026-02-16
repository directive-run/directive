import clsx from 'clsx'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import {
  BookOpenText,
  Cube,
  Lightbulb,
  PlugsConnected,
  RocketLaunch,
  Warning,
} from '@phosphor-icons/react/dist/ssr'

const icons: Record<string, PhosphorIcon> = {
  installation: RocketLaunch,
  presets: Cube,
  plugins: BookOpenText,
  theming: PlugsConnected,
  lightbulb: Lightbulb,
  warning: Warning,
}

const colorStyles = {
  blue: 'text-brand-primary',
  amber: 'text-amber-500',
}

export function Icon({
  icon,
  color = 'blue',
  className,
}: {
  color?: keyof typeof colorStyles
  icon: keyof typeof icons
  className?: string
}) {
  let IconComponent = icons[icon]

  return (
    <IconComponent
      weight="duotone"
      aria-hidden="true"
      className={clsx('h-8 w-8', colorStyles[color], className)}
    />
  )
}

import type { Metadata } from 'next'
import {
  ArrowRight,
  Code,
  GithubLogo,
  Globe,
  Lightning,
  LinkedinLogo,
  MapPin,
  Scales,
  Sparkle,
  User,
} from '@phosphor-icons/react/dist/ssr'

export const metadata: Metadata = {
  title: 'About — Directive',
  description:
    'Learn about the Directive project, its constraint-driven philosophy, and the developer behind it.',
}

const projectStats = [
  {
    label: 'MIT Licensed',
    description: 'Free and open source, forever',
    icon: Scales,
  },
  {
    label: 'TypeScript-First',
    description: 'Full type inference, zero codegen',
    icon: Code,
  },
  {
    label: 'Framework Agnostic',
    description: 'Works with React, Vue, Svelte, and more',
    icon: Globe,
  },
]

export default function AboutPage() {
  return (
    <div className="w-full py-16">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          About Directive
        </h1>
        <p className="mt-4 text-xl text-slate-600 dark:text-slate-400">
          A constraint-driven runtime for TypeScript. Declare what must be true,
          and let the runtime figure out how to make it happen.
        </p>

        {/* The Project */}
        <div className="mt-16">
          <h2 className="font-display text-3xl font-semibold text-slate-900 dark:text-white">
            The Project
          </h2>

          {/* Origin */}
          <div className="mt-8">
            <div className="flex items-center gap-3">
              <Lightning
                weight="duotone"
                className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Origin
              </h3>
            </div>
            <p className="mt-3 text-base leading-relaxed text-slate-600 dark:text-slate-400">
              Directive was born from building a game engine. When managing
              dozens of interconnected systems &ndash; physics, rendering, AI,
              audio &ndash; it became clear that traditional state management
              doesn&rsquo;t scale. Every state change triggered a cascade of
              manual orchestration: check this flag, update that dependency,
              notify these listeners. The realization was simple &ndash; state
              management shouldn&rsquo;t require you to be the runtime.
            </p>
          </div>

          {/* Philosophy */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <Sparkle
                weight="duotone"
                className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Philosophy
              </h3>
            </div>
            <p className="mt-3 text-base leading-relaxed text-slate-600 dark:text-slate-400">
              Most state management libraries ask you to describe{' '}
              <em>how</em> things change. Directive asks you to describe{' '}
              <em>what</em> must be true. You declare constraints &ndash; rules
              about your system&rsquo;s valid states &ndash; and the runtime
              resolves them automatically. When facts change, constraints
              evaluate, requirements emerge, and resolvers execute. No manual
              wiring, no action dispatching, no forgotten edge cases.
            </p>
          </div>

          {/* Vision */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <Globe
                weight="duotone"
                className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Vision
              </h3>
            </div>
            <p className="mt-3 text-base leading-relaxed text-slate-600 dark:text-slate-400">
              Directive is heading toward AI agent orchestration, where
              autonomous systems need to declare goals and let the runtime
              coordinate their resolution. The same constraint-driven model that
              manages UI state can manage multi-agent workflows, real-time
              collaboration, and complex business logic. Framework-agnostic by
              design, with developer experience at the core.
            </p>
          </div>
        </div>

        {/* Project stat cards */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {projectStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-brand-primary-50/20 border border-brand-primary-100/50 px-5 py-4 dark:bg-brand-primary-950/10 dark:border-brand-primary-800/20"
            >
              <stat.icon
                weight="duotone"
                className="h-8 w-8 text-brand-primary dark:text-brand-primary-400"
              />
              <p className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-white">
                {stat.label}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {stat.description}
              </p>
            </div>
          ))}
        </div>

        {/* The Author */}
        <div className="mt-20">
          <h2 className="font-display text-3xl font-semibold text-slate-900 dark:text-white">
            The Author
          </h2>

          <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start">
            {/* Avatar placeholder */}
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-brand-primary-50/30 ring-1 ring-brand-primary-200/40 dark:bg-brand-primary-950/20 dark:ring-brand-primary-800/20">
              <User
                weight="duotone"
                className="h-14 w-14 text-brand-primary/60 dark:text-brand-primary-400/60"
              />
            </div>

            <div>
              <h3 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
                Jason Comes
              </h3>
              <p className="mt-1 text-base font-medium text-slate-500 dark:text-slate-400">
                Engineer &middot; Tech Enthusiast &middot; Stack Strategist
              </p>
              <div className="mt-1.5 flex items-center gap-1.5 text-base text-slate-400 dark:text-slate-500">
                <MapPin weight="fill" className="h-4 w-4" />
                Somewhere in the Great Plains, USA
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
            <p>
              Jason is a full-stack engineer with over 20 years of experience
              building for the web. From freelancing custom web applications
              since 2006 to staff-level engineering roles at companies like Red
              Ventures and Prismatic, his career has been shaped by a deep
              curiosity for how systems work and a drive to make them better.
            </p>
            <p>
              Currently a Senior Application Engineer at Prismatic, he builds
              integration infrastructure for B2B software companies. That
              experience with complex, interconnected systems directly inspired
              Directive&rsquo;s constraint-driven approach.
            </p>
            <p>
              Beyond code, Jason is passionate about accessible web design,
              typography, and art &amp; illustration &ndash; interests that
              inform his attention to developer experience and the craft of
              building tools people actually enjoy using.
            </p>
          </div>

          {/* Links */}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href="https://www.linkedin.com/in/jasonwcomes/"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-6 py-3 text-sm font-semibold text-white shadow-sm transition-shadow hover:shadow-md dark:bg-brand-primary-600"
            >
              <LinkedinLogo weight="fill" className="h-5 w-5" />
              LinkedIn
              <ArrowRight className="h-4 w-4 opacity-60 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="https://github.com/sizls/directive"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-300 dark:border-slate-700 dark:text-white dark:hover:border-slate-600"
            >
              <GithubLogo weight="fill" className="h-5 w-5" />
              GitHub
              <ArrowRight className="h-4 w-4 opacity-60 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

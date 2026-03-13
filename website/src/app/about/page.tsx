import { BrandHeading } from "@/components/BrandHeading";
import { CardLink } from "@/components/CardLink";
import { ConstraintFlowDiagram } from "@/components/ConstraintFlowDiagram";
import { DirectiveCallout } from "@/components/DirectiveCallout";
import { buildPageMetadata } from "@/lib/metadata";
import {
  Code,
  GithubLogo,
  Globe,
  Lightning,
  LinkedinLogo,
  Package,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export const metadata = buildPageMetadata({
  title: "About – Directive",
  description:
    "Learn about the Directive project, its constraint-driven philosophy, and the team behind it.",
  path: "/about",
});

const projectStats = [
  {
    label: "Open Source",
    description: "MIT licensed, built in the open",
    icon: Globe,
  },
  {
    label: "Zero Dependencies",
    description: "Tree-shakeable, ~28KB gzipped",
    icon: Package,
  },
  {
    label: "TypeScript-First",
    description: "Full type inference, zero codegen",
    icon: Code,
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-16 sm:px-6 lg:px-8 xl:px-12">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          State management shouldn&rsquo;t require you to be the runtime.
        </h1>
        <p className="mt-4 text-xl text-slate-600 dark:text-slate-400">
          Directive is an open-source runtime for TypeScript that replaces
          manual state orchestration with declarative constraints. Hardened by
          3,050+ tests, designed to scale from UI state to AI agent
          coordination.
        </p>

        {/* Constraint Flow Diagram */}
        {/* <div className="mt-12">
          <ConstraintFlowDiagram />
        </div> */}

        {/* Engineering Standards */}
        <div className="mt-12 rounded-xl border border-slate-200/60 bg-brand-surface-card px-6 py-6 dark:border-slate-700/40 dark:bg-slate-800/30">
          <div className="flex items-center gap-3">
            <ShieldCheck
              weight="duotone"
              className="h-7 w-7 text-brand-primary dark:text-brand-primary-400"
            />
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Engineering Standards
            </h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Every change goes through architecture review, security audit, and
            runtime hardening analysis. The constraint engine, resolver
            pipeline, and effects system are continuously stress-tested.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-lg bg-brand-surface-card px-4 py-3 ring-1 ring-slate-200/60 dark:bg-slate-800/60 dark:ring-slate-700/40">
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                3,050+
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                tests passing
              </p>
            </div>
            <div className="rounded-lg bg-brand-surface-card px-4 py-3 ring-1 ring-slate-200/60 dark:bg-slate-800/60 dark:ring-slate-700/40">
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                0
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                runtime dependencies
              </p>
            </div>
            <div className="rounded-lg bg-brand-surface-card px-4 py-3 ring-1 ring-slate-200/60 dark:bg-slate-800/60 dark:ring-slate-700/40">
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                12
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                packages
              </p>
            </div>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Directive is built in the open. Contributions, bug reports, and
            RFCs are welcome on GitHub.
          </p>
        </div>

        {/* Stat Cards */}
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
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

        {/* Narrative */}
        <div className="mt-16">
          <h2 className="font-display text-3xl font-semibold text-slate-900 dark:text-white">
            The Project
          </h2>

          {/* What It Does */}
          <div className="mt-8">
            <div className="flex items-center gap-3">
              <Sparkle
                weight="duotone"
                className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                What It Does
              </h3>
            </div>
            <p className="mt-3 text-base leading-relaxed text-slate-600 dark:text-slate-400">
              Most state management libraries ask you to describe <em>how</em>{" "}
              things change. Directive asks you to describe <em>what</em> must
              be true. You declare constraints &ndash; rules about your
              system&rsquo;s valid states &ndash; and the runtime resolves them
              automatically. When facts change, constraints evaluate,
              requirements emerge, and resolvers execute. No manual wiring, no
              action dispatching, no forgotten edge cases.
            </p>
          </div>

          {/* Why It Exists */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <Lightning
                weight="duotone"
                className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Why It Exists
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

          {/* Where It's Going */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <Globe
                weight="duotone"
                className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Where It&rsquo;s Going
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

        {/* Philosophy Link */}
        <p className="mt-8 text-base text-slate-600 dark:text-slate-400">
          Directive is opinionated about how state should work.{" "}
          <Link
            href="/philosophy"
            className="font-semibold text-brand-primary hover:underline dark:text-brand-primary-400"
          >
            Read the full philosophy &rarr;
          </Link>
        </p>

        <BrandHeading className="mt-20">
          No limits.
          <br />
          No boundaries.
          <br />
          Just infinity.
        </BrandHeading>

        {/* Built by Sizls */}
        <div className="mt-20">
          <h2 className="font-display text-3xl font-semibold text-slate-900 dark:text-white">
            Built by Sizls
          </h2>

          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
            <p>
              Sizls is a small collective of talented individuals led by Jason
              Comes{" "}
              <a
                href="https://www.linkedin.com/in/jasonwcomes/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center transition-colors hover:text-[#0A66C2]"
                aria-label="Jason Comes on LinkedIn"
              >
                <LinkedinLogo
                  weight="fill"
                  className="h-5 w-5 text-current"
                />
              </a>{" "}
              that ships developer tools, apps, and interactive
              experiences&nbsp;&ndash; relentlessly.
            </p>
            <p>
              Directive is our open-source work. Everything else is the stuff we
              can&rsquo;t stop building. The source is on{" "}
              <a
                href="https://github.com/directive-run/directive"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-brand-primary dark:text-white dark:hover:text-brand-primary-400"
              >
                <GithubLogo weight="fill" className="h-4 w-4" />
                GitHub
              </a>
              &nbsp;&ndash; contributions, bug reports, and RFCs are welcome.
            </p>
          </div>

          {/* Social Links */}
          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CardLink
              href="https://www.linkedin.com/in/jasonwcomes/"
              external
              className="flex items-center gap-3 px-5 py-4"
            >
              <LinkedinLogo
                weight="fill"
                className="h-6 w-6 shrink-0 text-slate-400 group-hover:text-[#0A66C2]"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  LinkedIn
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Connect with Jason
                </p>
              </div>
            </CardLink>
            <CardLink
              href="https://github.com/directive-run/directive"
              external
              className="flex items-center gap-3 px-5 py-4"
            >
              <GithubLogo
                weight="fill"
                className="h-6 w-6 shrink-0 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  GitHub
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Star, contribute, or fork
                </p>
              </div>
            </CardLink>
          </div>

        </div>

        {/* Directive Callout */}
        {/* <div className="mt-6">
          <DirectiveCallout
            subject="website"
            href="/docs/quick-start"
            linkLabel="Get started"
          />
        </div> */}
      </div>
    </div>
  );
}

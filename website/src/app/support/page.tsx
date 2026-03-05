import { BrandHeading } from "@/components/BrandHeading";
import { CardLink } from "@/components/CardLink";
import { buildPageMetadata } from "@/lib/metadata";
import {
  ArrowRight,
  Coffee,
  Gift,
  Heart,
  Scales,
  ShieldCheck,
  Star,
  Terminal,
} from "@phosphor-icons/react/dist/ssr";

export const metadata = buildPageMetadata({
  title: "Support — Directive",
  description:
    "Support the Directive project through sponsorship, donations, or by starring us on GitHub.",
  path: "/support",
});

// Inline SVG logos for fictional sponsors
function AxiomLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="M16 4L28 28H4L16 4Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="20" r="3" fill="currentColor" />
    </svg>
  );
}

function MeridianLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="M4 16C4 9.373 9.373 4 16 4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M8 16C8 11.582 11.582 8 16 8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M12 16C12 13.791 13.791 12 16 12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      <path
        d="M28 16C28 22.627 22.627 28 16 28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M24 16C24 20.418 20.418 24 16 24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M20 16C20 18.209 18.209 20 16 20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TerrafoldLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect
        x="4"
        y="4"
        width="10"
        height="10"
        rx="2"
        fill="currentColor"
        opacity="0.3"
      />
      <rect
        x="18"
        y="4"
        width="10"
        height="10"
        rx="2"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="4"
        y="18"
        width="10"
        height="10"
        rx="2"
        fill="currentColor"
        opacity="0.6"
      />
      <rect x="18" y="18" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

function VortexLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="M16 4C16 4 24 8 24 16C24 24 16 28 16 28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M16 8C16 8 20 10.5 20 16C20 21.5 16 24 16 24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M16 28C16 28 8 24 8 16C8 8 16 4 16 4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}

function StacklineLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect
        x="6"
        y="6"
        width="20"
        height="4"
        rx="1"
        fill="currentColor"
        opacity="0.3"
      />
      <rect
        x="6"
        y="14"
        width="20"
        height="4"
        rx="1"
        fill="currentColor"
        opacity="0.6"
      />
      <rect x="6" y="22" width="20" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

function CanopyLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path d="M16 4L26 14H6L16 4Z" fill="currentColor" opacity="0.4" />
      <path d="M16 10L24 18H8L16 10Z" fill="currentColor" opacity="0.7" />
      <path d="M16 16L22 22H10L16 16Z" fill="currentColor" />
      <rect
        x="14"
        y="22"
        width="4"
        height="6"
        rx="1"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}

function IronbarkLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="M8 28V8L16 4L24 8V28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M8 16H24" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="22" r="2.5" fill="currentColor" />
    </svg>
  );
}

function LumenwaveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="M4 20C8 12 12 24 16 16C20 8 24 20 28 12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function MinglingoLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="10" cy="16" r="5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="22" cy="16" r="5" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M15 14C15 14 16 18 17 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UpklipLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="M16 24V8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M10 14L16 8L22 14"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="6"
        y="22"
        width="20"
        height="4"
        rx="2"
        fill="currentColor"
        opacity="0.3"
      />
    </svg>
  );
}

function FreeAgencyLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="10" r="4" fill="currentColor" opacity="0.4" />
      <path
        d="M8 26C8 21.582 11.582 18 16 18C20.418 18 24 21.582 24 26"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M22 8L26 4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M26 4L26 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M26 4L22 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TradeDeadlineLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M16 9V16L21 19"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WorkspacesLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect
        x="4"
        y="4"
        width="11"
        height="11"
        rx="2.5"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="17"
        y="4"
        width="11"
        height="11"
        rx="2.5"
        fill="currentColor"
        opacity="0.4"
      />
      <rect
        x="4"
        y="17"
        width="11"
        height="11"
        rx="2.5"
        fill="currentColor"
        opacity="0.4"
      />
      <rect
        x="17"
        y="17"
        width="11"
        height="11"
        rx="2.5"
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}

const GOLD_LOGOS: Record<string, React.FC<{ className?: string }>> = {
  Minglingo: MinglingoLogo,
  Upklip: UpklipLogo,
  "Free Agent Tracker": FreeAgencyLogo,
  "Trade Deadline Tracker": TradeDeadlineLogo,
  Workspaces: WorkspacesLogo,
  "Axiom Labs": AxiomLogo,
  "Meridian Cloud": MeridianLogo,
  Terrafold: TerrafoldLogo,
};

const SILVER_LOGOS: Record<string, React.FC<{ className?: string }>> = {
  "Vortex AI": VortexLogo,
  Stackline: StacklineLogo,
  "Canopy Data": CanopyLogo,
  Ironbark: IronbarkLogo,
  Lumenwave: LumenwaveLogo,
};

const stats = [
  {
    label: "Zero VC funding",
    description: "Independent and community-sustained",
    icon: ShieldCheck,
  },
  {
    label: "MIT Licensed",
    description: "Free forever, for everyone",
    icon: Scales,
  },
  {
    label: "Built in the open",
    description: "Every line of code is public",
    icon: Terminal,
  },
];

export default function SupportPage() {
  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-16 sm:px-6 lg:px-8 xl:px-12">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Support Directive
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Built by a small team working in the open. Every contribution helps
          keep this project alive, independent, and free.
        </p>

        {/* Impact stats */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {stats.map((stat) => (
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

        {/* Tiered CTAs */}
        <div className="mt-12 space-y-4">
          {/* Primary: GitHub Sponsors */}
          <a
            href="https://github.com/sponsors/directive-run"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-2xl bg-brand-primary px-6 py-5 text-white shadow-md transition-shadow hover:shadow-lg dark:bg-brand-primary-600"
          >
            <div className="flex items-center gap-4">
              <Heart weight="fill" className="h-8 w-8 shrink-0 text-white/80" />
              <div>
                <h3 className="font-display text-lg font-semibold">
                  GitHub Sponsors
                </h3>
                <p className="mt-0.5 text-sm text-white/80">
                  Become a backer &ndash; cancel anytime
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 opacity-60 transition-transform group-hover:translate-x-0.5" />
          </a>

          {/* Secondary: Buy Me a Coffee + Ko-fi */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CardLink
              href="https://buymeacoffee.com/sizls"
              external
              rounded="rounded-2xl"
              className="px-6 py-6"
            >
              <Coffee
                weight="duotone"
                className="h-8 w-8 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="mt-3 font-display text-lg font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                Buy Me a Coffee
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Fuel a late-night coding session
              </p>
            </CardLink>
            <CardLink
              href="https://ko-fi.com/sizls"
              external
              rounded="rounded-2xl"
              className="px-6 py-6"
            >
              <Gift
                weight="duotone"
                className="h-8 w-8 text-brand-primary dark:text-brand-primary-400"
              />
              <h3 className="mt-3 font-display text-lg font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                Ko-fi
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Drop a tip, make our day
              </p>
            </CardLink>
          </div>

          {/* Tertiary: Star on GitHub */}
          <CardLink
            href="https://github.com/directive-run/directive"
            external
            rounded="rounded-2xl"
            className="flex items-center justify-between px-6 py-6"
          >
            <div className="flex items-center gap-4">
              <Star weight="fill" className="h-8 w-8 shrink-0 text-amber-400" />
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  Star on GitHub
                </h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Free &ndash; costs nothing, means everything
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </CardLink>
        </div>

        <BrandHeading className="mt-16">
          No limits.
          <br />
          No boundaries.
          <br />
          Just infinity.
        </BrandHeading>

        {/* Sponsors */}
        <div className="mt-16">
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
            Sponsors &amp; Supporters
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Larger contributors get priority placement here and on the GitHub
            README.
          </p>

          {/* Gold tier */}
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">
              Gold
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                { name: "Minglingo", description: "Social discovery platform" },
                { name: "Upklip", description: "Content clipping tool" },
                {
                  name: "Free Agent Tracker",
                  description: "Sports free agency tracker",
                },
                {
                  name: "Trade Deadline Tracker",
                  description: "Trade deadline coverage",
                },
                { name: "Workspaces", description: "Team collaboration hub" },
                { name: "Axiom Labs", description: "Observability platform" },
                { name: "Meridian Cloud", description: "Edge infrastructure" },
                { name: "Terrafold", description: "Infrastructure automation" },
              ].map((sponsor) => {
                const Logo = GOLD_LOGOS[sponsor.name];

                return (
                  <div
                    key={sponsor.name}
                    className="flex flex-col items-center gap-2 rounded-xl border border-amber-200/50 bg-amber-50/30 px-4 py-5 dark:border-amber-800/20 dark:bg-amber-950/10"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                      {Logo ? (
                        <Logo className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <span className="font-display text-lg font-bold text-amber-600 dark:text-amber-400">
                          {sponsor.name[0]}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {sponsor.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {sponsor.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Silver tier */}
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Silver
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {[
                { name: "Vortex AI", description: "ML pipelines" },
                { name: "Stackline", description: "Developer tools" },
                { name: "Canopy Data", description: "Data warehouse" },
                { name: "Ironbark", description: "CI/CD platform" },
                { name: "Lumenwave", description: "Real-time analytics" },
              ].map((sponsor) => {
                const Logo = SILVER_LOGOS[sponsor.name];

                return (
                  <div
                    key={sponsor.name}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-4 dark:border-slate-700 dark:bg-slate-800/50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700">
                      {Logo ? (
                        <Logo className="h-6 w-6 text-slate-600 dark:text-slate-300" />
                      ) : (
                        <span className="font-display text-base font-bold text-slate-600 dark:text-slate-300">
                          {sponsor.name[0]}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      {sponsor.name}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {sponsor.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bronze tier */}
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Bronze
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                "Nimbus Systems",
                "Polaris Dev",
                "Fern Studio",
                "Keystone AI",
                "Railyard",
                "Cobalt Labs",
                "Drift Protocol",
                "Helix Runtime",
                "Pinecone Studios",
                "Waypoint HQ",
              ].map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-400"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

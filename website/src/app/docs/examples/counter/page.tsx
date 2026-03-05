import {
  parseExampleBuild,
  readExampleProject,
  readExampleSources,
} from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { CounterDemo } from "./CounterDemo";

export const metadata = buildPageMetadata({
  title: "Number Match",
  description:
    "Interactive Number Match game built with Directive. Constraint-driven pair matching, automatic refill, and game-over detection.",
  path: "/docs/examples/counter",
  section: "Docs",
});

export default function CounterPage() {
  const build = parseExampleBuild("counter");
  const sources = readExampleSources("counter", ["main.ts"]);
  const projectFiles = readExampleProject("counter");

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Number Match
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select pairs of numbers that add to 10 &mdash; constraint-driven game
          loop with automatic refill and win detection.
        </p>
      </header>

      <CounterDemo build={build} sources={sources} projectFiles={projectFiles} />
    </div>
  );
}

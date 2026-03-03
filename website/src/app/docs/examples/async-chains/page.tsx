import { parseExampleBuild, readExampleSources } from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { AsyncChainsDemo } from "./AsyncChainsDemo";

export const metadata = buildPageMetadata({
  title: "Async Chains",
  description:
    "Interactive async chain demo built with Directive. Three-module after chain with error propagation, retry, and parallel branches.",
  path: "/docs/examples/async-chains",
  section: "Docs",
});

export default function AsyncChainsPage() {
  const build = parseExampleBuild("async-chains");
  const sources = readExampleSources("async-chains", [
    "async-chains.ts",
    "mock-api.ts",
    "main.ts",
  ]);

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Async Chains
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Three-module async chain: auth &rarr; permissions &rarr; dashboard,
          with configurable failure rates and retry.
        </p>
      </header>

      <AsyncChainsDemo build={build} sources={sources} />
    </div>
  );
}

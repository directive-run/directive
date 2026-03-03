import { parseExampleBuild, readExampleSources } from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { DashboardLoaderDemo } from "./DashboardLoaderDemo";

export const metadata = buildPageMetadata({
  title: "Dashboard Loader",
  description:
    "Interactive dashboard data loader demo built with Directive. Watch concurrent fetches with configurable delays, failure rates, and retry policies.",
  path: "/docs/examples/dashboard-loader",
  section: "Docs",
});

export default function DashboardLoaderPage() {
  const build = parseExampleBuild("dashboard-loader");
  const sources = readExampleSources("dashboard-loader", [
    "dashboard-loader.ts",
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
          Dashboard Loader
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Concurrent data fetching with configurable delays, failure rates, and
          retry policies.
        </p>
      </header>

      <DashboardLoaderDemo build={build} sources={sources} />
    </div>
  );
}

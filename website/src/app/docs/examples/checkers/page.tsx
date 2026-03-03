import { parseExampleBuild, readExampleSources } from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { CheckersDemo } from "./CheckersDemo";

export const metadata = buildPageMetadata({
  title: "Checkers",
  description:
    "Interactive checkers game built with Directive. Play it, then read the source.",
  path: "/docs/examples/checkers",
  section: "Docs",
});

export default function CheckersPage() {
  const build = parseExampleBuild("checkers");
  const sources = readExampleSources("checkers", [
    "game.ts",
    "main.ts",
    "rules.ts",
  ]);

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Checkers
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Constraint-driven game logic with multi-module composition, AI
          integration, and time-travel debugging.
        </p>
      </header>

      <CheckersDemo build={build} sources={sources} />
    </div>
  );
}

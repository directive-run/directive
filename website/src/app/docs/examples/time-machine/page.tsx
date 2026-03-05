import {
  parseExampleBuild,
  readExampleProject,
  readExampleSources,
} from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { TimeMachineDemo } from "./TimeMachineDemo";

export const metadata = buildPageMetadata({
  title: "Time Machine",
  description:
    "Drawing canvas with full time-travel: undo/redo, export/import, replay animation, and changesets.",
  path: "/docs/examples/time-machine",
  section: "Docs",
});

export default function TimeMachinePage() {
  const build = parseExampleBuild("time-machine");
  const sources = readExampleSources("time-machine", ["main.ts"]);
  const projectFiles = readExampleProject("time-machine");

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Time Machine
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Drawing canvas with undo/redo, export/import, replay, and changesets.
        </p>
      </header>

      <TimeMachineDemo build={build} sources={sources} projectFiles={projectFiles} />
    </div>
  );
}

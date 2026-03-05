import {
  parseExampleBuild,
  readExampleProject,
  readExampleSources,
} from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { AiCheckpointDemo } from "./AiCheckpointDemo";

export const metadata = buildPageMetadata({
  title: "AI Pipeline Checkpoint",
  description:
    "4-stage document processing pipeline with checkpoint save/restore, retry with exponential backoff, and stage failure injection.",
  path: "/docs/examples/checkpoint",
  section: "Docs",
});

export default function AiCheckpointPage() {
  const build = parseExampleBuild("ai-checkpoint");
  const sources = readExampleSources("ai-checkpoint", ["main.ts"]);
  const projectFiles = readExampleProject("ai-checkpoint");

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          AI Pipeline Checkpoint
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          4-stage document pipeline with checkpointing, retry backoff, and
          failure injection.
        </p>
      </header>

      <AiCheckpointDemo build={build} sources={sources} projectFiles={projectFiles} />
    </div>
  );
}

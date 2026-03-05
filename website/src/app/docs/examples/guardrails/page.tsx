import {
  parseExampleBuild,
  readExampleProject,
  readExampleSources,
} from "@/lib/examples";
import { buildPageMetadata } from "@/lib/metadata";
import { AiGuardrailsDemo } from "./AiGuardrailsDemo";

export const metadata = buildPageMetadata({
  title: "AI Safety Shield",
  description:
    "Chat interface with prompt injection detection, PII detection, and compliance checks (GDPR/HIPAA).",
  path: "/docs/examples/guardrails",
  section: "Docs",
});

export default function AiGuardrailsPage() {
  const build = parseExampleBuild("ai-guardrails");
  const sources = readExampleSources("ai-guardrails", ["main.ts"]);
  const projectFiles = readExampleProject("ai-guardrails");

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          AI Safety Shield
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Prompt injection detection, PII redaction, and GDPR/HIPAA compliance
          checks.
        </p>
      </header>

      <AiGuardrailsDemo build={build} sources={sources} projectFiles={projectFiles} />
    </div>
  );
}

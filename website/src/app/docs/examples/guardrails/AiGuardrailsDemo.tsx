"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { ExampleEmbed } from "@/components/ExampleEmbed";

export function AiGuardrailsDemo({
  build,
  sources,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
}) {
  const mainSource = sources.find((s) => s.filename === "main.ts");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="ai-guardrails"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">
              pnpm build:example ai-guardrails
            </code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Use the quick test buttons to try injection attacks, SSN/credit card
          detection, and GDPR/HIPAA compliance checks. Toggle redaction to see
          raw vs. masked text.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Every message passes through three layers of guardrails using
            built-in detection from <code>@directive-run/ai</code>.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Prompt Injection
              </strong>{" "}
              &ndash; 16 built-in regex patterns detect override attempts,
              jailbreaks, and role manipulation
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                PII Detection
              </strong>{" "}
              &ndash; SSN, credit card (Luhn), email, phone, and address
              detection with typed redaction
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Compliance
              </strong>{" "}
              &ndash; GDPR blocks personal data (email, phone), HIPAA blocks PHI
              (SSN, medical IDs, DOB)
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            mainSource && {
              filename: "main.ts",
              label: "main.ts - System + DOM wiring",
              code: mainSource.code,
              language: "typescript",
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  );
}

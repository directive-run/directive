"use client";

import clsx from "clsx";
import Image from "next/image";
import { Highlight } from "prism-react-renderer";
import { Fragment, useState } from "react";

import { Button } from "@/components/Button";
import { HeroBackground } from "@/components/HeroBackground";
import blurCyanImage from "@/images/blur-cyan.png";
import blurIndigoImage from "@/images/blur-indigo.png";

const singleAgentCode = `import { createAgentOrchestrator, createPIIGuardrail } from '@directive-run/ai';
import { createOpenAIRunner } from '@directive-run/ai/openai';

const orchestrator = createAgentOrchestrator({
  runner: createOpenAIRunner({ model: 'gpt-4o-mini' }),

  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
  },

  constraints: {
    stuck: {
      when: (facts) => facts.agent.turnCount > 5,
      require: { type: 'ESCALATE' },
    },
  },

  resolvers: {
    escalate: {
      requirement: 'ESCALATE',
      resolve: async (req, context) => {
        await context.runAgent(
          { name: 'senior-support', instructions: 'Resolve escalated tickets.' },
          context.facts.agent.input!,
        );
      },
    },
  },

  maxTokenBudget: 10000,
});

const result = await orchestrator.run(
  { name: 'support', instructions: 'Help customers with billing questions.' },
  'My card ending in 4242 was charged twice.',
);`;

const multiAgentCode = `import { createMultiAgentOrchestrator, createToolGuardrail } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,

  agents: {
    researcher: {
      agent: {
        name: 'researcher',
        model: 'gpt-4o',
        instructions: 'Find accurate data with citations. Verify all claims.',
      },
      guardrails: {
        toolCall: [createToolGuardrail({ allowlist: ['search', 'readUrl'] })],
      },
    },
    writer: {
      agent: {
        name: 'writer',
        model: 'gpt-4o-mini',
        instructions: 'Write concise reports for executive audiences.',
      },
    },
  },

  maxTokenBudget: 50000,
});

const results = await orchestrator.runSequential(
  ['researcher', 'writer'],
  'Competitive analysis: How does our pricing compare to Stripe and Square?',
);`;

const tabs = [
  { name: "support.ts", language: "typescript" },
  { name: "pipeline.ts", language: "typescript" },
];

const codeBlocks = [singleAgentCode, multiAgentCode];

function TrafficLightsIcon(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 10" fill="none" {...props}>
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="21" cy="5" r="4.5" />
      <circle cx="37" cy="5" r="4.5" />
    </svg>
  );
}

export function AIHero() {
  const [activeTab, setActiveTab] = useState(0);
  const activeCode = codeBlocks[activeTab];
  const activeLanguage = tabs[activeTab].language;

  return (
    <div className="overflow-hidden bg-slate-900 dark:bg-brand-surface dark:-mb-32 dark:pb-32">
      <div className="py-16 sm:px-2 lg:relative lg:px-0 lg:py-20">
        <div className="mx-auto grid max-w-2xl grid-cols-1 items-center gap-x-8 gap-y-16 px-4 lg:max-w-8xl lg:grid-cols-[5fr_7fr] lg:px-8 xl:gap-x-16 xl:px-12">
          <div className="relative z-10 md:text-center lg:text-left">
            <Image
              className="absolute right-full bottom-full -mr-72 -mb-56 opacity-50"
              src={blurCyanImage}
              alt=""
              width={530}
              height={530}
              unoptimized
              priority
            />
            <div className="relative">
              <p
                className="inline bg-clip-text font-display text-5xl tracking-tight text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, var(--brand-gradient-from), var(--brand-gradient-via), var(--brand-gradient-to))",
                }}
              >
                Orchestrate AI agents declaratively.
              </p>
              <p className="mt-3 text-2xl tracking-tight text-slate-400">
                Constraint-driven AI orchestration &mdash; guardrails, budgets,
                multi-agent patterns, memory, and observability. Any LLM, full
                control.
              </p>
              <div className="mt-8 flex gap-4 md:justify-center lg:justify-start">
                <Button href="/ai/running-agents">Get started</Button>
                <Button
                  href="https://github.com/directive-run/directive"
                  variant="secondary"
                >
                  View on GitHub
                </Button>
              </div>
            </div>
          </div>
          <div className="relative lg:static">
            <div className="absolute inset-x-[-50vw] -top-32 -bottom-48 mask-[linear-gradient(transparent,white,white)] lg:-top-32 lg:right-0 lg:-bottom-32 lg:left-[calc(50%+14rem)] lg:mask-none dark:mask-[linear-gradient(transparent,white,transparent)] lg:dark:mask-[linear-gradient(white,white,transparent)]">
              <HeroBackground className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 lg:left-0 lg:translate-x-0 lg:translate-y-[-60%]" />
            </div>
            <div className="relative">
              <Image
                className="absolute -top-64 -right-64"
                src={blurCyanImage}
                alt=""
                width={530}
                height={530}
                unoptimized
                priority
              />
              <Image
                className="absolute -right-44 -bottom-40"
                src={blurIndigoImage}
                alt=""
                width={567}
                height={567}
                unoptimized
                priority
              />
              <div className="absolute inset-0 rounded-2xl bg-linear-to-tr from-brand-primary-300 via-brand-primary-300/70 to-brand-primary-200 opacity-10 blur-lg" />
              <div className="absolute inset-0 rounded-2xl bg-linear-to-tr from-brand-primary-300 via-brand-primary-300/70 to-brand-primary-200 opacity-10" />
              <div
                className="relative rounded-2xl"
                style={{
                  backgroundColor: "var(--hero-editor-bg)",
                  boxShadow:
                    "0 0 0 1px var(--hero-editor-ring), var(--hero-editor-shadow)",
                  backdropFilter: "var(--hero-editor-backdrop)",
                }}
              >
                <div className="absolute -top-px right-11 left-20 h-px bg-linear-to-r from-brand-primary-300/0 via-brand-primary-300/70 to-brand-primary-300/0" />
                <div className="absolute right-20 -bottom-px left-11 h-px bg-linear-to-r from-brand-accent-400/0 via-brand-accent-400 to-brand-accent-400/0" />
                <div className="pt-4 pl-4">
                  <TrafficLightsIcon
                    className="h-2.5 w-auto"
                    style={{ stroke: "var(--hero-traffic-stroke)" }}
                  />
                  <div className="mt-4 flex space-x-2 text-xs">
                    {tabs.map((tab, index) => (
                      <div
                        key={tab.name}
                        className={clsx(
                          "flex h-6 cursor-pointer rounded-full",
                          index === activeTab
                            ? "bg-linear-to-r from-brand-primary-400/30 via-brand-primary-400 to-brand-primary-400/30 p-px font-medium"
                            : "hero-pill-inactive",
                        )}
                        style={
                          index === activeTab
                            ? { color: "var(--hero-pill-active-text)" }
                            : undefined
                        }
                        onClick={() => setActiveTab(index)}
                      >
                        <div
                          className={clsx(
                            "flex items-center rounded-full px-2.5",
                          )}
                          style={
                            index === activeTab
                              ? {
                                  backgroundColor: "var(--hero-pill-active-bg)",
                                }
                              : undefined
                          }
                        >
                          {tab.name}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex items-start px-1 text-sm">
                    <div
                      aria-hidden="true"
                      className="border-r pr-4 font-mono select-none"
                      style={{
                        borderColor: "var(--hero-line-border)",
                        color: "var(--hero-line-text)",
                      }}
                    >
                      {Array.from({
                        length: activeCode.split("\n").length,
                      }).map((_, index) => (
                        <Fragment key={index}>
                          {(index + 1).toString().padStart(2, "0")}
                          <br />
                        </Fragment>
                      ))}
                    </div>
                    <Highlight
                      code={activeCode}
                      language={activeLanguage}
                      theme={{ plain: {}, styles: [] }}
                    >
                      {({
                        className,
                        style,
                        tokens,
                        getLineProps,
                        getTokenProps,
                      }) => (
                        <pre
                          className={clsx(
                            className,
                            "flex overflow-x-auto pb-6 !bg-transparent",
                          )}
                          style={style}
                        >
                          <code className="px-4">
                            {tokens.map((line, lineIndex) => (
                              <div key={lineIndex} {...getLineProps({ line })}>
                                {line.map((token, tokenIndex) => (
                                  <span
                                    key={tokenIndex}
                                    {...getTokenProps({ token })}
                                  />
                                ))}
                              </div>
                            ))}
                          </code>
                        </pre>
                      )}
                    </Highlight>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { CardLink } from "@/components/CardLink";
import { Flag, Robot, TextAa } from "@phosphor-icons/react/dist/ssr";

const useCases = [
  {
    icon: Flag,
    title: "Feature Flags",
    description:
      "Ship features safely with constraint-driven flags \u2013 no third-party service needed.",
    href: "/blog/feature-flags-without-a-service",
  },
  {
    icon: TextAa,
    title: "Declarative Forms",
    description:
      "Model validation, submission, and error states as constraints.",
    href: "/blog/declarative-forms-with-directive",
  },
  {
    icon: Robot,
    title: "AI Agents",
    description:
      "Orchestrate LLM calls, guardrails, and tool use with constraints.",
    href: "/blog/building-ai-agents",
  },
];

export function UseCaseCards() {
  return (
    <div className="not-prose my-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
      {useCases.map((useCase) => (
        <CardLink key={useCase.title} href={useCase.href} className="p-6">
          <useCase.icon
            className="h-8 w-8 text-brand-primary dark:text-brand-primary-light"
            weight="duotone"
          />
          <h3 className="mt-4 font-display text-base text-slate-900 dark:text-white">
            {useCase.title}
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-400">
            {useCase.description}
          </p>
        </CardLink>
      ))}
    </div>
  );
}

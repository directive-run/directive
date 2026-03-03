import {
  CheckCircle,
  Circle,
  CircleDashed,
} from "@phosphor-icons/react/dist/ssr";

export function ChecklistItem({
  status,
  children,
}: {
  status: "checked" | "progress" | "unchecked";
  children: React.ReactNode;
}) {
  return (
    <li className="-ml-[1.625em] pl-4 flex items-start gap-2 list-none">
      {status === "checked" ? (
        <CheckCircle
          weight="duotone"
          aria-hidden="true"
          className="mt-[0.1875rem] h-5 w-5 shrink-0 text-brand-primary"
        />
      ) : status === "progress" ? (
        <CircleDashed
          aria-hidden="true"
          className="mt-[0.1875rem] h-5 w-5 shrink-0 text-brand-primary"
        />
      ) : (
        <Circle
          aria-hidden="true"
          className="mt-[0.1875rem] h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500"
        />
      )}
      <span>{children}</span>
    </li>
  );
}

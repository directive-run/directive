import { Logomark } from "@/components/Logo";

export function DirectiveLogomark({
  className = "h-5 w-5",
}: { className?: string }) {
  return <Logomark className={className} />;
}

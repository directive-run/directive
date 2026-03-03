"use client";

import { DevToolsWithProvider } from "@/components/DevToolsWithProvider";
import { usePathname } from "next/navigation";

export default function ExamplesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const slug = pathname?.split("/").pop() || "";

  // All examples use system mode. AI tabs auto-appear when examples emit
  // client-side AI events via the emitDevToolsEvent bridge.
  return (
    <DevToolsWithProvider key={slug} mode="system">
      {children}
    </DevToolsWithProvider>
  );
}

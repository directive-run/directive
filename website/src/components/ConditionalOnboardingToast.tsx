"use client";

import { ThemeOnboardingToast } from "@/components/ThemeOnboardingToast";
import { useCanShowOnboardingToast } from "@/lib/feature-flags";

export function ConditionalOnboardingToast() {
  const canShow = useCanShowOnboardingToast();

  if (!canShow) {
    return null;
  }

  return <ThemeOnboardingToast />;
}

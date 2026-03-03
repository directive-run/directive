"use client";

import { usePathname } from "next/navigation";

import {
  type DocsVersion,
  getVersionFromPath,
  getVersionsForScope,
} from "@/lib/versions";

/**
 * Parse the current pathname to determine the active docs version.
 * Returns the matched DocsVersion plus all versions in the same scope.
 */
export function useDocsVersion(): {
  version: DocsVersion;
  allVersions: DocsVersion[];
} {
  const pathname = usePathname();
  const version = getVersionFromPath(pathname);
  const allVersions = getVersionsForScope(version.scope);

  return { version, allVersions };
}

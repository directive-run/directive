import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface MonorepoInfo {
  isMonorepo: boolean;
  rootDir: string;
  tool?: "pnpm" | "turbo" | "npm" | "yarn";
}

const MONOREPO_SIGNALS = [
  { file: "pnpm-workspace.yaml", tool: "pnpm" as const },
  { file: "turbo.json", tool: "turbo" as const },
];

export function detectMonorepo(startDir: string): MonorepoInfo {
  let dir = resolve(startDir);

  while (dir !== dirname(dir)) {
    for (const signal of MONOREPO_SIGNALS) {
      if (existsSync(join(dir, signal.file))) {
        return { isMonorepo: true, rootDir: dir, tool: signal.tool };
      }
    }

    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) {
          const tool = existsSync(join(dir, "yarn.lock"))
            ? ("yarn" as const)
            : ("npm" as const);

          return { isMonorepo: true, rootDir: dir, tool };
        }
      } catch {
        // ignore parse errors
      }
    }

    dir = dirname(dir);
  }

  return { isMonorepo: false, rootDir: startDir };
}

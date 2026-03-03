/**
 * Build one or all interactive examples and copy to website/public/examples/.
 *
 * Usage:
 *   pnpm build:example checkers     # Build one example
 *   pnpm build:examples             # Build all that have vite.config.ts
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VALID_NAME = /^[a-z0-9-]+$/;
const ROOT = path.resolve(__dirname, "..", "..");
const EXAMPLES_DIR = path.join(ROOT, "examples");
const PUBLIC_DIR = path.join(ROOT, "website", "public", "examples");

function buildExample(name: string): void {
  if (!VALID_NAME.test(name)) {
    console.error(`Invalid example name: "${name}" (must match ${VALID_NAME})`);
    process.exit(1);
  }

  const exampleDir = path.join(EXAMPLES_DIR, name);
  const distDir = path.join(exampleDir, "dist");
  const targetDir = path.join(PUBLIC_DIR, name);

  if (!fs.existsSync(exampleDir)) {
    console.error(`Example "${name}" not found at ${exampleDir}`);
    process.exit(1);
  }

  console.log(`\nBuilding @directive-run/example-${name}...`);
  execFileSync(
    "pnpm",
    ["--filter", `@directive-run/example-${name}`, "build"],
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );

  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    console.error(`Build failed: ${distDir}/index.html not found`);
    process.exit(1);
  }

  // Clean target directory before copy to remove orphaned assets
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  copyDirSync(distDir, targetDir);
  console.log(`Copied to ${path.relative(ROOT, targetDir)}`);
}

function copyDirSync(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function findBuildableExamples(): string[] {
  return fs
    .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) {
        return false;
      }

      return fs.existsSync(
        path.join(EXAMPLES_DIR, entry.name, "vite.config.ts"),
      );
    })
    .map((entry) => entry.name);
}

// CLI
const args = process.argv.slice(2);
const buildAll = args.includes("--all");

if (buildAll) {
  const examples = findBuildableExamples();
  console.log(`Building ${examples.length} examples: ${examples.join(", ")}`);

  for (const name of examples) {
    buildExample(name);
  }

  console.log("\nAll examples built.");
} else if (args.length > 0 && !args[0].startsWith("-")) {
  buildExample(args[0]);
} else {
  console.log("Usage:");
  console.log("  pnpm build:example <name>   Build one example");
  console.log(
    "  pnpm build:examples         Build all examples with vite.config.ts",
  );
  process.exit(1);
}

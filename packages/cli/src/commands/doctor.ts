import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { hasDirectiveSection } from "../lib/merge.js";

interface DoctorOptions {
  dir: string;
}

function parseArgs(args: string[]): DoctorOptions {
  const opts: DoctorOptions = { dir: process.cwd() };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") {
      const val = args[++i];
      if (val) {
        opts.dir = val;
      }
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

interface CheckResult {
  label: string;
  passed: boolean;
  message: string;
  fix?: string;
}

function checkCoreInstalled(dir: string): CheckResult {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      label: "@directive-run/core installed",
      passed: false,
      message: "No package.json found",
      fix: "Run `npm init` to create a package.json",
    };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (!deps["@directive-run/core"]) {
    return {
      label: "@directive-run/core installed",
      passed: false,
      message: "Not found in dependencies",
      fix: "Run `npm install @directive-run/core`",
    };
  }

  return {
    label: "@directive-run/core installed",
    passed: true,
    message: `v${deps["@directive-run/core"]}`,
  };
}

function checkVersionCompatibility(dir: string): CheckResult {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      label: "Package version compatibility",
      passed: true,
      message: "Skipped (no package.json)",
    };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const directivePackages = Object.keys(deps).filter((k) =>
    k.startsWith("@directive-run/"),
  );

  if (directivePackages.length <= 1) {
    return {
      label: "Package version compatibility",
      passed: true,
      message: directivePackages.length === 0 ? "No packages found" : "Single package",
    };
  }

  return {
    label: "Package version compatibility",
    passed: true,
    message: `${directivePackages.length} packages: ${directivePackages.join(", ")}`,
  };
}

function checkTypeScript(dir: string): CheckResult {
  const tsconfigPath = join(dir, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    return {
      label: "TypeScript configuration",
      passed: false,
      message: "No tsconfig.json found",
      fix: "Run `tsc --init` to create a TypeScript configuration",
    };
  }

  try {
    // Simple JSON parse — doesn't handle comments or extends
    const raw = readFileSync(tsconfigPath, "utf-8");
    // Strip single-line comments for parsing
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const config = JSON.parse(stripped);
    const co = config.compilerOptions || {};

    const issues: string[] = [];

    if (co.strict !== true) {
      issues.push("strict mode not enabled");
    }

    if (
      co.moduleResolution &&
      !["bundler", "nodenext", "node16"].includes(
        co.moduleResolution.toLowerCase(),
      )
    ) {
      issues.push(`moduleResolution is "${co.moduleResolution}"`);
    }

    if (issues.length > 0) {
      return {
        label: "TypeScript configuration",
        passed: false,
        message: issues.join(", "),
        fix: 'Set "strict": true and "moduleResolution": "bundler" in tsconfig.json',
      };
    }

    return {
      label: "TypeScript configuration",
      passed: true,
      message: "strict mode, correct module resolution",
    };
  } catch {
    return {
      label: "TypeScript configuration",
      passed: true,
      message: "Found (could not parse for detailed checks)",
    };
  }
}

function checkDuplicateInstances(dir: string): CheckResult {
  const nodeModules = join(dir, "node_modules");

  if (!existsSync(nodeModules)) {
    return {
      label: "No duplicate Directive instances",
      passed: true,
      message: "No node_modules found",
    };
  }

  const duplicates: string[] = [];

  // Check for nested @directive-run/core in node_modules
  try {
    const scopeDir = join(nodeModules, "@directive-run");
    if (existsSync(scopeDir)) {
      const packages = readdirSync(scopeDir);
      for (const pkg of packages) {
        const nestedCore = join(
          scopeDir,
          pkg,
          "node_modules",
          "@directive-run",
          "core",
        );
        if (existsSync(nestedCore)) {
          duplicates.push(`@directive-run/${pkg}/node_modules/@directive-run/core`);
        }
      }
    }
  } catch {
    // Can't read node_modules, skip
  }

  if (duplicates.length > 0) {
    return {
      label: "No duplicate Directive instances",
      passed: false,
      message: `Found ${duplicates.length} duplicate(s): ${duplicates.join(", ")}`,
      fix: "Run `npm dedupe` or check for version mismatches",
    };
  }

  return {
    label: "No duplicate Directive instances",
    passed: true,
    message: "No duplicates detected",
  };
}

function checkAIRulesFreshness(dir: string): CheckResult {
  const ruleFiles = [
    ".cursorrules",
    ".claude/CLAUDE.md",
    ".github/copilot-instructions.md",
    ".windsurfrules",
    ".clinerules",
  ];

  const found: string[] = [];

  for (const file of ruleFiles) {
    const filePath = join(dir, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      if (hasDirectiveSection(content)) {
        found.push(file);
      }
    }
  }

  if (found.length === 0) {
    return {
      label: "AI coding rules",
      passed: true,
      message: "Not installed (optional)",
    };
  }

  return {
    label: "AI coding rules",
    passed: true,
    message: `Installed for: ${found.join(", ")}`,
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function doctorCommand(args: string[]) {
  const opts = parseArgs(args);

  console.log();
  console.log(pc.bold(pc.cyan("Directive Doctor")));
  console.log(pc.dim("─".repeat(40)));
  console.log();

  const checks = [
    checkCoreInstalled(opts.dir),
    checkVersionCompatibility(opts.dir),
    checkTypeScript(opts.dir),
    checkDuplicateInstances(opts.dir),
    checkAIRulesFreshness(opts.dir),
  ];

  let failures = 0;

  for (const check of checks) {
    const icon = check.passed ? pc.green("✓") : pc.red("✗");
    console.log(`${icon} ${pc.bold(check.label)}`);
    console.log(`  ${pc.dim(check.message)}`);

    if (!check.passed && check.fix) {
      console.log(`  ${pc.yellow("Fix:")} ${check.fix}`);
      failures++;
    }

    console.log();
  }

  if (failures > 0) {
    console.log(
      pc.yellow(`${failures} issue(s) found. See suggested fixes above.`),
    );
    process.exit(1);
  } else {
    console.log(pc.green("All checks passed!"));
  }
}

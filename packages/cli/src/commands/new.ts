import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  MODULE_SECTIONS,
  type ModuleSection,
  generateModule,
  generateOrchestrator,
  suggestFileNames,
  validateModuleName,
} from "@directive-run/scaffold";
import pc from "picocolors";

interface NewOptions {
  with: string[];
  minimal: boolean;
  dir: string;
}

function parseArgs(args: string[]): NewOptions {
  const opts: NewOptions = {
    with: [],
    minimal: false,
    dir: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--with": {
        const val = args[++i];
        if (val) {
          opts.with = val.split(",").map((s) => s.trim());
        }
        break;
      }
      case "--minimal":
        opts.minimal = true;
        break;
      case "--dir": {
        const val = args[++i];
        if (val) {
          opts.dir = val;
        }
        break;
      }
    }
  }

  return opts;
}

function writeFile(filePath: string, content: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf-8");
}

function findModulesDir(dir: string): string {
  return join(dir, "src");
}

function reportInvalidName(
  kind: "module" | "orchestrator",
  name: string,
): never {
  const reason = validateModuleName(name);
  const detail = reason === true ? "" : `: ${reason}`;
  console.error(`Invalid ${kind} name: ${name || "(none)"}${detail}`);
  console.error(
    "Must start with a lowercase letter, use lowercase letters, numbers, and hyphens.",
  );
  process.exit(1);
}

export async function newModuleCommand(name: string, args: string[]) {
  const opts = parseArgs(args);

  if (validateModuleName(name) !== true) {
    reportInvalidName("module", name);
    return;
  }

  let sections: ModuleSection[];

  if (opts.minimal) {
    sections = [];
  } else if (opts.with.length > 0) {
    sections = opts.with.filter((s): s is ModuleSection =>
      (MODULE_SECTIONS as readonly string[]).includes(s),
    );
  } else {
    sections = [...MODULE_SECTIONS];
  }

  const { sourceFileName } = suggestFileNames(name, "module");
  const targetDir = findModulesDir(opts.dir);
  const filePath = join(targetDir, sourceFileName);

  if (existsSync(filePath)) {
    console.error(`File already exists: ${relative(opts.dir, filePath)}`);
    process.exit(1);
  }

  // CLI writes a library file to disk; the paired runnerSource is the
  // MCP playground's concern and is ignored here.
  const { moduleSource } = generateModule(name, sections);
  writeFile(filePath, moduleSource);

  const rel = relative(opts.dir, filePath);
  console.log(`${pc.green("Created")} ${pc.dim(rel)}`);

  if (sections.length === 0) {
    console.log(pc.dim("  Minimal module (schema + init only)"));
  } else {
    console.log(pc.dim(`  Sections: ${sections.join(", ")}`));
  }
}

export async function newOrchestratorCommand(name: string, args: string[]) {
  const opts = parseArgs(args);

  if (validateModuleName(name) !== true) {
    reportInvalidName("orchestrator", name);
    return;
  }

  const { sourceFileName } = suggestFileNames(name, "orchestrator");
  const targetDir = findModulesDir(opts.dir);
  const filePath = join(targetDir, sourceFileName);

  if (existsSync(filePath)) {
    console.error(`File already exists: ${relative(opts.dir, filePath)}`);
    process.exit(1);
  }

  const { moduleSource } = generateOrchestrator(name);
  writeFile(filePath, moduleSource);

  const rel = relative(opts.dir, filePath);
  console.log(`${pc.green("Created")} ${pc.dim(rel)}`);
  console.log(
    pc.dim("  AI orchestrator with memory, guardrails, and streaming"),
  );
}

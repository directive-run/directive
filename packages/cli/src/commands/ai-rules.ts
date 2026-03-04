import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import pc from "picocolors";
import { CLI_NAME } from "../lib/constants.js";
import {
  type DetectedTool,
  detectTools,
  getAllToolIds,
  getToolConfig,
} from "../lib/detect.js";
import { hasDirectiveSection, mergeSection } from "../lib/merge.js";
import { detectMonorepo } from "../lib/monorepo.js";
import { getTemplate } from "../templates/index.js";

interface Options {
  force: boolean;
  merge: boolean;
  tools: string[];
  dir: string;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    force: false,
    merge: false,
    tools: [],
    dir: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--force":
        opts.force = true;
        break;
      case "--merge":
        opts.merge = true;
        break;
      case "--tool": {
        const val = args[++i];
        if (val) {
          opts.tools.push(val);
        }
        break;
      }
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

export async function aiRulesCommand(args: string[]) {
  const opts = parseArgs(args);

  p.intro(pc.bgCyan(pc.black(" directive ai-rules ")));

  // Step 1: Detect monorepo
  const mono = detectMonorepo(opts.dir);
  let targetDir = opts.dir;

  if (mono.isMonorepo && mono.rootDir !== opts.dir) {
    const placement = await p.select({
      message: "Monorepo detected. Where should AI rules be installed?",
      options: [
        {
          value: "root",
          label: `Monorepo root (${relative(opts.dir, mono.rootDir) || "."})`,
          hint: "recommended",
        },
        {
          value: "workspace",
          label: `Current workspace (${relative(mono.rootDir, opts.dir)})`,
        },
      ],
    });

    if (p.isCancel(placement)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    if (placement === "root") {
      targetDir = mono.rootDir;
    }
  }

  // Step 2: Detect or select tools
  let selectedTools: DetectedTool[];

  if (opts.tools.length > 0) {
    selectedTools = opts.tools.map((id) => {
      const config = getToolConfig(id as DetectedTool["id"]);

      return {
        name: config.name,
        id: config.id,
        outputPath: join(targetDir, config.outputPath),
      };
    });
  } else {
    const detected = detectTools(targetDir);

    if (detected.length > 0) {
      const choices = await p.multiselect({
        message: `Detected ${detected.length} AI tool(s). Which should get Directive rules?`,
        options: detected.map((t) => ({
          value: t.id,
          label: t.name,
          hint: relative(targetDir, t.outputPath),
        })),
        initialValues: detected.map((t) => t.id),
        required: true,
      });

      if (p.isCancel(choices)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      selectedTools = (choices as DetectedTool["id"][]).map((id) => {
        const config = getToolConfig(id);

        return {
          name: config.name,
          id: config.id,
          outputPath: join(targetDir, config.outputPath),
        };
      });
    } else {
      const choices = await p.multiselect({
        message:
          "No AI tools detected. Which tools do you use?",
        options: getAllToolIds().map((id) => {
          const config = getToolConfig(id);

          return { value: id, label: config.name };
        }),
        required: true,
      });

      if (p.isCancel(choices)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      selectedTools = (choices as DetectedTool["id"][]).map((id) => {
        const config = getToolConfig(id);

        return {
          name: config.name,
          id: config.id,
          outputPath: join(targetDir, config.outputPath),
        };
      });
    }
  }

  if (selectedTools.length === 0) {
    p.cancel("No tools selected.");
    process.exit(0);
  }

  // Step 3: Write files
  const s = p.spinner();

  for (const tool of selectedTools) {
    s.start(`Generating ${tool.name} rules...`);

    const content = getTemplate(tool.id);
    const filePath = tool.outputPath;
    const fileExists = existsSync(filePath);

    s.stop(`Generated ${tool.name} rules.`);

    if (fileExists && !opts.force) {
      const existingContent = readFileSync(filePath, "utf-8");

      if (opts.merge) {
        writeFile(filePath, mergeSection(existingContent, content));
        p.log.success(
          `${pc.green("Merged")} Directive section into ${pc.dim(relative(targetDir, filePath))}`,
        );
        continue;
      }

      if (hasDirectiveSection(existingContent)) {
        const action = await p.select({
          message: `${relative(targetDir, filePath)} already has a Directive section. What should we do?`,
          options: [
            {
              value: "merge",
              label: "Update Directive section only",
              hint: "recommended",
            },
            { value: "overwrite", label: "Overwrite entire file" },
            { value: "skip", label: "Skip this file" },
          ],
        });

        if (p.isCancel(action)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        if (action === "merge") {
          writeFile(filePath, mergeSection(existingContent, content));
          p.log.success(
            `${pc.green("Updated")} ${pc.dim(relative(targetDir, filePath))}`,
          );
        } else if (action === "overwrite") {
          writeFile(filePath, content);
          p.log.success(
            `${pc.green("Wrote")} ${pc.dim(relative(targetDir, filePath))}`,
          );
        } else {
          p.log.info(`Skipped ${pc.dim(relative(targetDir, filePath))}`);
        }
      } else {
        const action = await p.select({
          message: `${relative(targetDir, filePath)} already exists. What should we do?`,
          options: [
            {
              value: "append",
              label: "Append Directive section",
              hint: "preserves existing content",
            },
            { value: "overwrite", label: "Overwrite entire file" },
            { value: "skip", label: "Skip this file" },
          ],
        });

        if (p.isCancel(action)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        if (action === "append") {
          writeFile(filePath, mergeSection(existingContent, content));
          p.log.success(
            `${pc.green("Appended")} to ${pc.dim(relative(targetDir, filePath))}`,
          );
        } else if (action === "overwrite") {
          writeFile(filePath, content);
          p.log.success(
            `${pc.green("Wrote")} ${pc.dim(relative(targetDir, filePath))}`,
          );
        } else {
          p.log.info(`Skipped ${pc.dim(relative(targetDir, filePath))}`);
        }
      }
    } else {
      writeFile(filePath, content);
      p.log.success(
        `${pc.green("Created")} ${pc.dim(relative(targetDir, filePath))}`,
      );
    }
  }

  p.outro(
    `Done! Run ${pc.cyan(`${CLI_NAME} ai-rules init --merge`)} anytime to update.`,
  );
}

function writeFile(filePath: string, content: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// ai-rules update — regenerate all existing rule files
// ---------------------------------------------------------------------------

export async function aiRulesUpdateCommand(args: string[]) {
  const opts = parseArgs(args);
  const targetDir = opts.dir;

  const ruleFiles: Array<{ id: DetectedTool["id"]; path: string }> = [
    { id: "cursor", path: join(targetDir, ".cursorrules") },
    { id: "claude", path: join(targetDir, ".claude/CLAUDE.md") },
    { id: "copilot", path: join(targetDir, ".github/copilot-instructions.md") },
    { id: "windsurf", path: join(targetDir, ".windsurfrules") },
    { id: "cline", path: join(targetDir, ".clinerules") },
  ];

  let updated = 0;

  for (const file of ruleFiles) {
    if (!existsSync(file.path)) {
      continue;
    }

    const existing = readFileSync(file.path, "utf-8");
    if (!hasDirectiveSection(existing)) {
      continue;
    }

    const newContent = getTemplate(file.id);
    const merged = mergeSection(existing, newContent);

    writeFile(file.path, merged);
    console.log(
      `${pc.green("Updated")} ${pc.dim(relative(targetDir, file.path))}`,
    );
    updated++;
  }

  if (updated === 0) {
    console.log(
      pc.dim(
        `No existing rule files found. Run ${pc.cyan(`${CLI_NAME} ai-rules init`)} first.`,
      ),
    );
  } else {
    console.log(
      pc.green(`\nUpdated ${updated} file(s) to latest knowledge version.`),
    );
  }
}

// ---------------------------------------------------------------------------
// ai-rules check — exit non-zero if rules are stale (CI-friendly)
// ---------------------------------------------------------------------------

export async function aiRulesCheckCommand(args: string[]) {
  const opts = parseArgs(args);
  const targetDir = opts.dir;

  const ruleFiles: Array<{ id: DetectedTool["id"]; path: string; name: string }> = [
    { id: "cursor", path: join(targetDir, ".cursorrules"), name: "Cursor" },
    { id: "claude", path: join(targetDir, ".claude/CLAUDE.md"), name: "Claude Code" },
    { id: "copilot", path: join(targetDir, ".github/copilot-instructions.md"), name: "GitHub Copilot" },
    { id: "windsurf", path: join(targetDir, ".windsurfrules"), name: "Windsurf" },
    { id: "cline", path: join(targetDir, ".clinerules"), name: "Cline" },
  ];

  let checked = 0;
  let stale = 0;

  for (const file of ruleFiles) {
    if (!existsSync(file.path)) {
      continue;
    }

    const existing = readFileSync(file.path, "utf-8");
    if (!hasDirectiveSection(existing)) {
      continue;
    }

    checked++;

    // Generate fresh content and merge, then compare
    const freshContent = getTemplate(file.id);
    const merged = mergeSection(existing, freshContent);

    if (merged !== existing) {
      console.log(`${pc.red("✗")} ${file.name} rules are ${pc.yellow("stale")}`);
      stale++;
    } else {
      console.log(`${pc.green("✓")} ${file.name} rules are ${pc.green("current")}`);
    }
  }

  if (checked === 0) {
    console.log(pc.dim("No rule files found to check."));

    return;
  }

  if (stale > 0) {
    console.log(
      `\n${pc.yellow(`${stale} file(s) are stale.`)} Run ${pc.cyan(`${CLI_NAME} ai-rules update`)} to refresh.`,
    );
    process.exit(1);
  } else {
    console.log(pc.green("\nAll rule files are current."));
  }
}

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

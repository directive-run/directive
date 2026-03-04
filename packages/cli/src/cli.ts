import { CLI_NAME } from "./lib/constants.js";
import {
  aiRulesCommand,
  aiRulesUpdateCommand,
  aiRulesCheckCommand,
} from "./commands/ai-rules.js";
import { initCommand } from "./commands/init.js";
import { newModuleCommand, newOrchestratorCommand } from "./commands/new.js";
import { inspectCommand } from "./commands/inspect.js";
import { explainCommand } from "./commands/explain.js";
import { graphCommand } from "./commands/graph.js";
import { doctorCommand } from "./commands/doctor.js";
import { examplesListCommand, examplesCopyCommand } from "./commands/examples.js";

const HELP = `
${CLI_NAME} — CLI tools for Directive

Usage: ${CLI_NAME} <command> [options]

Commands:
  init                          Project scaffolding wizard
  new module <name>             Generate a module file
  new orchestrator <name>       Generate an AI orchestrator
  inspect <file>                Runtime system introspection
  explain <file> [req-id]       Explain why a requirement exists
  graph <file>                  Visual dependency graph
  doctor                        Health check for project setup
  ai-rules init                 Install AI coding rules
  ai-rules update               Refresh rules to latest version
  ai-rules check                Validate rules are current (CI)
  examples list                 Browse available examples
  examples copy <name>          Extract example to project

Options:
  --help, -h                    Show this help message
  --version, -v                 Show version

init options:
  --template <name>             Template: counter, auth-flow, ai-orchestrator
  --dir <path>                  Target directory (default: cwd)
  --no-interactive              Skip prompts, use defaults

new module options:
  --with <sections>             Sections: derive,events,constraints,resolvers,effects
  --minimal                     Schema + init only
  --dir <path>                  Target directory (default: cwd)

inspect options:
  --json                        Output as JSON
  --module <name>               Inspect specific module

graph options:
  --ascii                       Terminal-only output
  --no-open                     Don't open in browser
  --output <path>               Output file path

ai-rules init options:
  --force                       Overwrite existing files without asking
  --merge                       Use section markers to update only the Directive section
  --tool <name>                 Skip detection, install for specific tool(s)
  --dir <path>                  Target directory (default: cwd)

examples options:
  --filter <category>           Filter by category or name
  --dest <dir>                  Destination directory for copy
`.trim();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    );

    console.log(pkg.version);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "init": {
      await initCommand(args.slice(1));
      break;
    }

    case "new": {
      const subcommand = args[1];
      const name = args[2];

      if (subcommand === "module") {
        if (!name) {
          console.error("Usage: directive new module <name>");
          process.exit(1);
        }
        await newModuleCommand(name, args.slice(3));
      } else if (subcommand === "orchestrator") {
        if (!name) {
          console.error("Usage: directive new orchestrator <name>");
          process.exit(1);
        }
        await newOrchestratorCommand(name, args.slice(3));
      } else {
        console.error(
          `Unknown subcommand: ${subcommand ?? "(none)"}\n` +
            `Usage: ${CLI_NAME} new module <name>\n` +
            `       ${CLI_NAME} new orchestrator <name>`,
        );
        process.exit(1);
      }
      break;
    }

    case "inspect": {
      await inspectCommand(args.slice(1));
      break;
    }

    case "explain": {
      await explainCommand(args.slice(1));
      break;
    }

    case "graph": {
      await graphCommand(args.slice(1));
      break;
    }

    case "doctor": {
      await doctorCommand(args.slice(1));
      break;
    }

    case "ai-rules": {
      const subcommand = args[1];

      if (subcommand === "init") {
        await aiRulesCommand(args.slice(2));
      } else if (subcommand === "update") {
        await aiRulesUpdateCommand(args.slice(2));
      } else if (subcommand === "check") {
        await aiRulesCheckCommand(args.slice(2));
      } else {
        console.error(
          `Unknown subcommand: ${subcommand ?? "(none)"}\n` +
            `Usage: ${CLI_NAME} ai-rules init\n` +
            `       ${CLI_NAME} ai-rules update\n` +
            `       ${CLI_NAME} ai-rules check`,
        );
        process.exit(1);
      }
      break;
    }

    case "examples": {
      const subcommand = args[1];

      if (subcommand === "list") {
        await examplesListCommand(args.slice(2));
      } else if (subcommand === "copy") {
        const name = args[2];
        if (!name) {
          console.error("Usage: directive examples copy <name>");
          process.exit(1);
        }
        await examplesCopyCommand(name, args.slice(3));
      } else {
        console.error(
          `Unknown subcommand: ${subcommand ?? "(none)"}\n` +
            `Usage: ${CLI_NAME} examples list [--filter <category>]\n` +
            `       ${CLI_NAME} examples copy <name> [--dest <dir>]`,
        );
        process.exit(1);
      }
      break;
    }

    default:
      console.error(
        `Unknown command: ${command}\nRun '${CLI_NAME} --help' for usage.`,
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

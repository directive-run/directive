import { CLI_NAME } from "./lib/constants.js";
import { aiRulesCommand } from "./commands/ai-rules.js";

const HELP = `
${CLI_NAME} — CLI tools for Directive

Usage: ${CLI_NAME} <command> [subcommand] [options]

Commands:
  ai-rules init             Interactive wizard to install AI coding rules

Options:
  --help, -h                Show this help message
  --version, -v             Show version

ai-rules init options:
  --force                   Overwrite existing files without asking
  --merge                   Use section markers to update only the Directive section
  --tool <name>             Skip detection, install for specific tool(s)
  --dir <path>              Target directory (default: cwd)
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
    case "ai-rules": {
      const subcommand = args[1];

      if (subcommand !== "init") {
        console.error(
          `Unknown subcommand: ${subcommand ?? "(none)"}\nRun '${CLI_NAME} ai-rules init' to get started.`,
        );
        process.exit(1);
      }

      await aiRulesCommand(args.slice(2));
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

import pc from "picocolors";
import { loadSystem } from "../lib/loader.js";

interface ExplainOptions {
  module?: string;
}

function parseArgs(
  args: string[],
): { filePath: string; requirementId?: string; opts: ExplainOptions } {
  const opts: ExplainOptions = {};
  let filePath = "";
  let requirementId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--module": {
        const val = args[++i];
        if (val) {
          opts.module = val;
        }
        break;
      }
      default:
        if (arg && !arg.startsWith("-")) {
          if (!filePath) {
            filePath = arg;
          } else if (!requirementId) {
            requirementId = arg;
          }
        }
    }
  }

  return { filePath, requirementId, opts };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function explainCommand(args: string[]) {
  const { filePath, requirementId } = parseArgs(args);

  if (!filePath) {
    console.error(
      "Usage: directive explain <file> [requirement-id]",
    );
    process.exit(1);
  }

  const system = await loadSystem(filePath);

  if (!system.isRunning) {
    system.start();
  }

  const inspection = system.inspect();

  if (requirementId) {
    // Explain a specific requirement
    const explanation = system.explain(requirementId);

    if (!explanation) {
      console.error(
        `Requirement "${requirementId}" not found.\n\n` +
          "Current requirements:",
      );

      if (inspection.unmet.length === 0) {
        console.log(pc.dim("  (no unmet requirements)"));
      } else {
        for (const u of inspection.unmet) {
          console.log(
            `  ${pc.cyan(u.id)} — ${u.requirement.type} (from ${u.fromConstraint})`,
          );
        }
      }

      system.stop();
      process.exit(1);
    }

    console.log();
    console.log(pc.bold(pc.cyan("Requirement Explanation")));
    console.log(pc.dim("─".repeat(40)));
    console.log();
    console.log(explanation);
    console.log();
  } else {
    // List all requirements with status
    console.log();
    console.log(pc.bold(pc.cyan("All Requirements")));
    console.log(pc.dim("─".repeat(40)));
    console.log();

    if (inspection.unmet.length === 0) {
      console.log(pc.green("All requirements are met."));
      console.log();

      // Show resolver history if available
      const resolverEntries = Object.entries(
        inspection.resolvers as Record<string, { state: string; duration?: number; error?: string }>,
      );
      if (resolverEntries.length > 0) {
        console.log(pc.bold("Recent Resolver Activity:"));
        for (const [key, status] of resolverEntries) {
          const state = formatState(status.state);
          const dur =
            status.duration !== undefined ? ` (${status.duration}ms)` : "";
          console.log(`  ${pc.cyan(key)}  ${state}${dur}`);
        }
        console.log();
      }
    } else {
      console.log(
        `${pc.yellow(String(inspection.unmet.length))} unmet requirement(s):\n`,
      );

      for (const u of inspection.unmet) {
        console.log(
          `${pc.yellow("●")} ${pc.bold(u.requirement.type)} (id: ${pc.dim(u.id)})`,
        );
        console.log(`  From constraint: ${pc.cyan(u.fromConstraint)}`);

        // Show payload
        const payload = { ...u.requirement };
        delete (payload as Record<string, unknown>).type;
        const payloadKeys = Object.keys(payload);
        if (payloadKeys.length > 0) {
          console.log(`  Payload: ${JSON.stringify(payload)}`);
        }

        // Check resolver status
        const resolverStatus = (inspection.resolvers as Record<string, { state: string; error?: string } | undefined>)[u.id];
        if (resolverStatus) {
          console.log(
            `  Resolver: ${formatState(resolverStatus.state)}${resolverStatus.error ? ` — ${resolverStatus.error}` : ""}`,
          );
        } else {
          // Check if any resolver handles this type
          const hasResolver = inspection.resolverDefs.some(
            (r: { id: string; requirement: string }) =>
              r.requirement === u.requirement.type ||
              r.requirement === "(predicate)",
          );
          if (!hasResolver) {
            console.log(`  ${pc.red("No resolver registered for this type")}`);
          }
        }

        console.log();
      }

      console.log(
        pc.dim(
          `Run ${pc.cyan(`directive explain <file> <requirement-id>`)} for detailed explanation.`,
        ),
      );
    }
  }

  system.stop();
}

function formatState(state: string): string {
  switch (state) {
    case "resolved":
      return pc.green("resolved");
    case "errored":
      return pc.red("errored");
    case "inflight":
      return pc.yellow("inflight");
    case "pending":
      return pc.yellow("pending");
    case "cancelled":
      return pc.dim("cancelled");
    default:
      return pc.dim(state);
  }
}

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface DetectedTool {
  name: string;
  id: "cursor" | "claude" | "copilot" | "windsurf" | "cline";
  outputPath: string;
}

const TOOL_SIGNALS: Array<{
  id: DetectedTool["id"];
  name: string;
  signals: string[];
  outputPath: string;
}> = [
  {
    id: "cursor",
    name: "Cursor",
    signals: [".cursor", ".cursorrules"],
    outputPath: ".cursorrules",
  },
  {
    id: "claude",
    name: "Claude Code",
    signals: [".claude"],
    outputPath: ".claude/CLAUDE.md",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    signals: [".github"],
    outputPath: ".github/copilot-instructions.md",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    signals: [".windsurfrules"],
    outputPath: ".windsurfrules",
  },
  {
    id: "cline",
    name: "Cline",
    signals: [".clinerules"],
    outputPath: ".clinerules",
  },
];

export function detectTools(rootDir: string): DetectedTool[] {
  const detected: DetectedTool[] = [];

  for (const tool of TOOL_SIGNALS) {
    const hasSignal = tool.signals.some((signal) =>
      existsSync(join(rootDir, signal)),
    );

    if (hasSignal) {
      detected.push({
        name: tool.name,
        id: tool.id,
        outputPath: join(rootDir, tool.outputPath),
      });
    }
  }

  return detected;
}

export function getToolConfig(id: DetectedTool["id"]) {
  const tool = TOOL_SIGNALS.find((t) => t.id === id);
  if (!tool) {
    throw new Error(`Unknown tool: ${id}`);
  }

  return tool;
}

export function getAllToolIds(): DetectedTool["id"][] {
  return TOOL_SIGNALS.map((t) => t.id);
}

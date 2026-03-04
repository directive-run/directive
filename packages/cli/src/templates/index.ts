import type { DetectedTool } from "../lib/detect.js";
import { generateClaudeRules } from "./claude.js";
import { generateClineRules } from "./cline.js";
import { generateCopilotRules } from "./copilot.js";
import { generateCursorRules } from "./cursor.js";
import { generateLlmsTxt } from "./llms-txt.js";
import { generateWindsurfRules } from "./windsurf.js";

const generators: Record<DetectedTool["id"], () => string> = {
  cursor: generateCursorRules,
  claude: generateClaudeRules,
  copilot: generateCopilotRules,
  windsurf: generateWindsurfRules,
  cline: generateClineRules,
};

export function getTemplate(toolId: DetectedTool["id"]): string {
  const generator = generators[toolId];
  if (!generator) {
    throw new Error(`No template for tool: ${toolId}`);
  }

  return generator();
}

export { generateLlmsTxt };

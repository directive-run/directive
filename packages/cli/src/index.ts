// Templates
export { getTemplate, generateLlmsTxt } from "./templates/index.js";

// Detection
export { detectTools, type DetectedTool } from "./lib/detect.js";
export { detectMonorepo, type MonorepoInfo } from "./lib/monorepo.js";

// Merging
export { mergeSection, hasDirectiveSection } from "./lib/merge.js";

// Knowledge
export {
  getKnowledge,
  getAllKnowledge,
  getExample,
  getAllExamples,
  getKnowledgeFiles,
  getExampleFiles,
} from "./lib/knowledge.js";

// System loader
export { loadSystem } from "./lib/loader.js";

// Constants
export { CLI_NAME, PACKAGE_NAME, SECTION_START, SECTION_END } from "./lib/constants.js";

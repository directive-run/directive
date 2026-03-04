export { getTemplate, generateLlmsTxt } from "./templates/index.js";
export { detectTools, type DetectedTool } from "./lib/detect.js";
export { detectMonorepo, type MonorepoInfo } from "./lib/monorepo.js";
export { mergeSection, hasDirectiveSection } from "./lib/merge.js";
export { CLI_NAME, PACKAGE_NAME, SECTION_START, SECTION_END } from "./lib/constants.js";

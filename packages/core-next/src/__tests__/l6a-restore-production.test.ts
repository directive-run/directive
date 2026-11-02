import { vi } from "vitest";
import { restoreCases } from "./l6a-restore.cases.js";

vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystemCore } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

restoreCases({ createModule, createSystem, createSystemCore, t }, "production");

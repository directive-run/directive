import { vi } from "vitest";
import { gateWriteCases } from "./l5b-gate-write.cases.js";

vi.mock("#is-development", () => ({ default: false }));

const core = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

gateWriteCases({ ...core, createSystem, t }, "production");

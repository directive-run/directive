import * as core from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { gateWriteCases } from "./l5b-gate-write.cases.js";

gateWriteCases({ ...core, createSystem, t }, "development");

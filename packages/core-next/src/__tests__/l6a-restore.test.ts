import { createModule, createSystemCore } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { restoreCases } from "./l6a-restore.cases.js";

restoreCases(
  { createModule, createSystem, createSystemCore, t },
  "development",
);

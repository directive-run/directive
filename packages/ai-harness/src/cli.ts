#!/usr/bin/env node
/**
 * The `harness` binary.
 *
 * Everything is in `./adapters/cli/index.js`, which returns an exit code rather
 * than calling `process.exit` — so the CLI is callable from a test and this
 * file is the only thing that knows about the process.
 *
 * @module
 */

import { runCli } from "./adapters/cli/index.js";

const code = await runCli(process.argv.slice(2));

process.exitCode = code;

// Wrapper around `@directive-run/sandbox`'s `runInSandbox` for the
// `run_in_sandbox` MCP tool. Mirrors the shape of `lint-runner.ts` —
// validates input bounds at the MCP boundary before delegating, maps
// sandbox errors to structured tool responses so the LLM gets a
// predictable error code instead of a stack trace.

import { runInSandbox } from "@directive-run/sandbox";
import type { PlaygroundFile, SandboxResult } from "@directive-run/sandbox";

const MAX_SOURCE_BYTES = 200_000;
const MAX_FILES = 10;
const FILE_PATH_RE = /^[\w./-]{1,128}$/;

export class SandboxRunnerError extends Error {
  constructor(
    message: string,
    public readonly code: "input-too-large" | "input-invalid" | "runtime-error",
  ) {
    super(message);
  }
}

export interface SandboxRunInput {
  source?: string;
  files?: PlaygroundFile[];
  timeoutMs?: number;
}

function validateBounds(input: SandboxRunInput): void {
  if (input.files) {
    if (input.files.length > MAX_FILES) {
      throw new SandboxRunnerError(
        `payload exceeds ${MAX_FILES} files`,
        "input-invalid",
      );
    }
    let totalBytes = 0;
    for (const file of input.files) {
      if (!FILE_PATH_RE.test(file.path)) {
        throw new SandboxRunnerError(
          `invalid file path: '${file.path}'`,
          "input-invalid",
        );
      }
      totalBytes += Buffer.byteLength(file.source, "utf8");
    }
    if (totalBytes > MAX_SOURCE_BYTES) {
      throw new SandboxRunnerError(
        `payload is ${totalBytes} bytes (max ${MAX_SOURCE_BYTES})`,
        "input-too-large",
      );
    }
  } else if (input.source) {
    const bytes = Buffer.byteLength(input.source, "utf8");
    if (bytes > MAX_SOURCE_BYTES) {
      throw new SandboxRunnerError(
        `source is ${bytes} bytes (max ${MAX_SOURCE_BYTES})`,
        "input-too-large",
      );
    }
  }
}

export async function runInSandboxTool(
  input: SandboxRunInput,
): Promise<SandboxResult> {
  validateBounds(input);
  return runInSandbox(input);
}

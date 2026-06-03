/**
 * CLI entry for `@directive-run/mcp`.
 *
 * Default transport is stdio — the canonical MCP local-client
 * pattern (Claude Desktop, Cursor MCP, MCP Inspector). Pass `--sse`
 * to start the HTTP SSE server instead, for hosting the package
 * at `mcp.directive.run` or in a private MCP gateway.
 *
 * Usage:
 *
 *   directive-mcp                # stdio
 *   directive-mcp --sse          # SSE on 127.0.0.1:3000
 *   directive-mcp --sse \
 *     --port 8080 --host 0.0.0.0           # SSE on 0.0.0.0:8080
 *   directive-mcp --help
 *   directive-mcp --version
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDirectiveServer, setServerInfo } from "./server.js";
import { startSseServer } from "./sse.js";

const VERSION = "0.2.0";

const USAGE = `directive-mcp — MCP server exposing Directive to AI clients

Usage:
  directive-mcp                                  Run stdio transport (default)
  directive-mcp --sse                            Run SSE transport on 127.0.0.1:3000
  directive-mcp --sse --port 8080 --host 0.0.0.0 \\
    --token <secret> --allow-origin https://app.example.com

Options:
  --sse                       Use HTTP SSE transport instead of stdio
  --port <port>               SSE port (default: 3000)
  --host <host>               SSE bind host (default: 127.0.0.1)
  --token <value>             Bearer token required on /sse and /messages requests.
                              MANDATORY when --host is not loopback. Can also be
                              passed via the DIRECTIVE_MCP_TOKEN env var.
  --allow-origin <origin>     Permitted Origin header value. Repeatable. When
                              omitted, no Origin check is performed.
  --help, -h                  Show this help
  --version, -v               Show package version

Docs: https://directive.run/docs/ide-integration
`;

interface ParsedArgs {
  sse: boolean;
  port: number;
  host: string;
  help: boolean;
  version: boolean;
  token?: string;
  allowOrigins: string[];
}

function requireValue(argv: string[], index: number, flag: string): string {
  const next = argv[index];
  if (!next) {
    throw new Error(`${flag} requires a value`);
  }
  return next;
}

function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`invalid --port: ${value}`);
  }
  return n;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    sse: false,
    port: 3000,
    host: "127.0.0.1",
    help: false,
    version: false,
    allowOrigins: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--sse":
        result.sse = true;
        break;
      case "--port":
        result.port = parsePort(requireValue(argv, ++i, "--port"));
        break;
      case "--host":
        result.host = requireValue(argv, ++i, "--host");
        break;
      case "--token":
        result.token = requireValue(argv, ++i, "--token");
        break;
      case "--allow-origin":
        result.allowOrigins.push(requireValue(argv, ++i, "--allow-origin"));
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--version":
      case "-v":
        result.version = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return result;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (args.sse) {
    const httpServer = await startSseServer({
      port: args.port,
      host: args.host,
      token: args.token,
      allowOrigins: args.allowOrigins,
    });

    const shutdown = () => {
      httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    return;
  }

  setServerInfo({ transport: "stdio", authEnabled: false });
  const server = createDirectiveServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[directive-mcp] fatal: ${(err as Error).stack ?? String(err)}\n`,
  );
  process.exit(1);
});

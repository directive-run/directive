---
"@directive-run/mcp": patch
---

**Bug fix:** the MCP handshake and `get_server_info` were reporting the source-hardcoded `PKG_VERSION = "0.2.0"` long after the package shipped 0.2.1 — the constant was easy to forget on patch bumps. The constant is now sourced from `package.json` via tsup's `define` at build time, so `changeset version`'s bump is the single source of truth and the dist version can't drift from the published one. CLI's `--version` flag picks up the same value through the same channel.

In `tsx` dev runs (no build), both fall back to `0.0.0-dev` so handshakes don't claim a real version.

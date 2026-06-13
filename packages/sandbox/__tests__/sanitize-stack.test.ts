// Path-leak coverage for the worker→host→client stack sanitizer.
// Every regex pattern has at least one positive + one negative case.

import { describe, expect, it } from "vitest";
import { sanitizeStack } from "../src/sanitize-stack.js";

describe("sanitizeStack", () => {
  it("returns empty string for undefined input", () => {
    expect(sanitizeStack(undefined)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeStack("")).toBe("");
  });

  it("strips file:// URLs", () => {
    const input = "    at fn (file:///private/var/folders/abc/bundle.mjs:1:1)";
    const out = sanitizeStack(input);
    expect(out).not.toMatch(/file:\/\//);
    expect(out).toMatch(/<sandbox>/);
  });

  it("strips POSIX /Users/<name>/ — macOS dev home", () => {
    const out = sanitizeStack(
      "TypeError: x\n    at fn (/Users/jason/Desktop/proj/file.ts:10:1)",
    );
    expect(out).not.toMatch(/\/Users\/jason/);
    expect(out).toMatch(/\/<home>/);
  });

  it("strips POSIX /home/<user>/ — Linux dev home", () => {
    const out = sanitizeStack(
      "Error: y\n    at fn (/home/runner/work/repo/file.ts:1:1)",
    );
    expect(out).not.toMatch(/\/home\/runner/);
    expect(out).toMatch(/\/<home>/);
  });

  it("strips macOS /private/var/ tempdirs", () => {
    const out = sanitizeStack(
      "    at fn (/private/var/folders/xy/abc/tmp/file.mjs:1:1)",
    );
    expect(out).not.toMatch(/\/private\/var\/folders/);
    expect(out).toMatch(/<tmp>/);
  });

  it("strips /var/task/ — Lambda + Vercel function root", () => {
    const out = sanitizeStack(
      "    at handler (/var/task/dist/route.js:42:5)",
    );
    expect(out).not.toMatch(/\/var\/task\/dist/);
    expect(out).toMatch(/<task>/);
  });

  it("strips /tmp/ — generic Linux tmp", () => {
    const out = sanitizeStack("    at fn (/tmp/sandbox-abc/bundle.mjs:1:1)");
    expect(out).not.toMatch(/\/tmp\/sandbox/);
    expect(out).toMatch(/<tmp>/);
  });

  it("strips /opt/ — common Linux distro / Render / Heroku app prefix", () => {
    const out = sanitizeStack("    at fn (/opt/render/project/src/file.js:1:1)");
    expect(out).not.toMatch(/\/opt\/render/);
    expect(out).toMatch(/<opt>/);
  });

  it("strips /usr/local/ — package install prefix", () => {
    const out = sanitizeStack("    at fn (/usr/local/share/lib.js:1:1)");
    expect(out).not.toMatch(/\/usr\/local\/share/);
    expect(out).toMatch(/<usr-local>/);
  });

  it("strips /app/ — Heroku / Render / Docker app root", () => {
    const out = sanitizeStack(
      "    at fn (/app/node_modules/@directive-run/sandbox/dist/worker.js:1:1)",
    );
    expect(out).not.toMatch(/\/app\/node_modules/);
    expect(out).toMatch(/<app>/);
  });

  it("strips /srv/ — Linux service deploy root", () => {
    const out = sanitizeStack("    at fn (/srv/api/dist/server.js:1:1)");
    expect(out).not.toMatch(/\/srv\/api/);
    expect(out).toMatch(/<srv>/);
  });

  it("strips /workspace/ — Codespaces / GitHub Actions root", () => {
    const out = sanitizeStack("    at fn (/workspace/src/file.ts:1:1)");
    expect(out).not.toMatch(/\/workspace\/src/);
    expect(out).toMatch(/<workspace>/);
  });

  it("strips /data/ — common volume mount root", () => {
    const out = sanitizeStack("    at fn (/data/storage/config.json:1:1)");
    expect(out).not.toMatch(/\/data\/storage/);
    expect(out).toMatch(/<data>/);
  });

  it("strips /etc/ — Linux config root", () => {
    const out = sanitizeStack("    at fn (/etc/ssl/certs/ca.pem:1:1)");
    expect(out).not.toMatch(/\/etc\/ssl/);
    expect(out).toMatch(/<etc>/);
  });

  it("strips /root/ — Linux root home", () => {
    const out = sanitizeStack("    at fn (/root/.ssh/id_rsa:1:1)");
    expect(out).not.toMatch(/\/root\/\.ssh/);
    expect(out).toMatch(/<root>/);
  });

  it("strips Windows C:\\Users\\<name>\\ paths", () => {
    const out = sanitizeStack(
      "    at fn (C:\\Users\\jason\\AppData\\Local\\Temp\\bundle.mjs:1:1)",
    );
    expect(out).not.toMatch(/C:\\Users\\jason/);
    expect(out).toMatch(/<home>/);
  });

  it("strips Windows D:\\... generic drive paths (CI runner layouts)", () => {
    const out = sanitizeStack("    at fn (D:\\a\\_work\\repo\\file.ts:1:1)");
    expect(out).not.toMatch(/D:\\a\\_work/);
    expect(out).toMatch(/<path>/);
  });

  it("strips Windows UNC \\\\server\\share\\ paths", () => {
    const out = sanitizeStack(
      "    at fn (\\\\file-server\\dev-team\\repo\\file.ts:1:1)",
    );
    expect(out).not.toMatch(/file-server\\dev-team/);
    expect(out).toMatch(/<unc>/);
  });

  it("leaves non-path content untouched", () => {
    const input = "Error: Cannot find module 'foo' (from a registered loader)";
    const out = sanitizeStack(input);
    expect(out).toBe(input);
  });

  it("strips multiple paths in one trace", () => {
    const out = sanitizeStack(
      [
        "Error: failed",
        "    at fn (/Users/dev/proj/a.ts:1:1)",
        "    at next (/var/task/b.js:2:2)",
        "    at last (file:///tmp/c.mjs:3:3)",
      ].join("\n"),
    );
    expect(out).not.toMatch(/\/Users\/dev/);
    expect(out).not.toMatch(/\/var\/task/);
    expect(out).not.toMatch(/file:\/\//);
    expect(out.split("<home>").length).toBeGreaterThan(1);
    expect(out.split("<task>").length).toBeGreaterThan(1);
  });

  it("terminates paths on comma + quote (JSON-embedded paths)", () => {
    const out = sanitizeStack(
      'JSON: {"file":"/Users/dev/a.ts","line":1}',
    );
    expect(out).not.toMatch(/\/Users\/dev\/a\.ts/);
    expect(out).toMatch(/\/<home>/);
    // The closing quote + brace should be preserved.
    expect(out).toMatch(/","line":1\}/);
  });
});

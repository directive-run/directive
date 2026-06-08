// Unit tests for the SSRF fetch wrapper (P0-S2). The wrapper itself
// is pure synchronous URL-checking; the integration with worker fetch
// is verified through the run-in-sandbox tests.

import { describe, expect, it } from "vitest";
import { checkSandboxFetchUrl } from "../src/fetch-wrapper.js";

describe("checkSandboxFetchUrl", () => {
  it("allows public HTTPS URLs", () => {
    const result = checkSandboxFetchUrl("https://example.com/x");
    expect(result.allow).toBe(true);
  });

  it("allows public HTTP URLs (validator still controls reachability)", () => {
    const result = checkSandboxFetchUrl("http://example.com/");
    expect(result.allow).toBe(true);
  });

  it.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "data:text/html,<script>",
    "gopher://attacker/",
    "javascript:alert(1)",
  ])("rejects non-http(s) protocol: %s", (url) => {
    const result = checkSandboxFetchUrl(url);
    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/protocol/i);
  });

  it.each([
    "http://localhost/",
    "http://localhost:3000/",
    "http://LOCALHOST/",
    "https://my-service.local/",
    "http://kubernetes.internal/",
  ])("rejects local hostname: %s", (url) => {
    const result = checkSandboxFetchUrl(url);
    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/localhost|internal/i);
  });

  it.each(["http://127.0.0.1/", "http://127.0.0.1:8080/", "http://0.0.0.0/"])(
    "rejects loopback IPv4: %s",
    (url) => {
      const result = checkSandboxFetchUrl(url);
      expect(result.allow).toBe(false);
      expect(result.reason).toMatch(/private|loopback|link-local/i);
    },
  );

  it("rejects AWS/GCP/Azure IMDS at 169.254.169.254", () => {
    const result = checkSandboxFetchUrl(
      "http://169.254.169.254/latest/meta-data/",
    );
    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/private|link-local/i);
  });

  it.each([
    "http://10.0.0.1/",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.0.1/",
    "http://192.168.255.255/",
  ])("rejects RFC-1918 private IPv4: %s", (url) => {
    const result = checkSandboxFetchUrl(url);
    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });

  it("rejects IPv6 loopback ::1", () => {
    const result = checkSandboxFetchUrl("http://[::1]/");
    expect(result.allow).toBe(false);
  });

  it("rejects IPv6 link-local fe80::", () => {
    const result = checkSandboxFetchUrl("http://[fe80::1]/");
    expect(result.allow).toBe(false);
  });

  it("rejects IPv6 unique-local fc00::/7", () => {
    const result = checkSandboxFetchUrl("http://[fc00::1]/");
    expect(result.allow).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 for IMDS (::ffff:169.254.169.254)", () => {
    const result = checkSandboxFetchUrl("http://[::ffff:169.254.169.254]/");
    expect(result.allow).toBe(false);
  });

  it("rejects multicast 224.0.0.0/4", () => {
    const result = checkSandboxFetchUrl("http://224.0.0.1/");
    expect(result.allow).toBe(false);
  });

  it("rejects carrier-grade NAT 100.64.0.0/10", () => {
    const result = checkSandboxFetchUrl("http://100.64.0.1/");
    expect(result.allow).toBe(false);
  });

  it("rejects malformed URLs", () => {
    const result = checkSandboxFetchUrl("not a url");
    expect(result.allow).toBe(false);
  });
});

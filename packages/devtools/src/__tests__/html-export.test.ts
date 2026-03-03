import { describe, expect, it } from "vitest";
import { generateStandaloneHTML } from "../lib/html-export";
import type { DebugEvent } from "../lib/types";

function makeEvent(
  overrides: Partial<DebugEvent> & {
    id: number;
    type: DebugEvent["type"];
    timestamp: number;
  },
): DebugEvent {
  return { snapshotId: null, ...overrides } as DebugEvent;
}

describe("generateStandaloneHTML", () => {
  it("generates valid HTML for empty events", () => {
    const html = generateStandaloneHTML([]);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("No events");
  });

  it("generates HTML with events embedded as JSON", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "agent_start",
        timestamp: 1000,
        agentId: "test",
      }),
    ];
    const html = generateStandaloneHTML(events);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("agent_start");
    // Events should be embedded in a <script> block
    expect(html).toContain("var EVENTS =");
  });

  it("escapes </script> sequences in JSON", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "agent_error",
        timestamp: 1000,
        errorMessage: "</script><script>alert(1)</script>",
      }),
    ];
    const html = generateStandaloneHTML(events);
    // Should NOT contain raw </script> in the JSON (would break the HTML)
    const jsonSection = html.split("var EVENTS = ")[1]!.split(";")[0]!;
    expect(jsonSection).not.toContain("</script>");
    // But should contain the escaped version
    expect(jsonSection).toContain("<\\/script>");
  });

  it("escapes Unicode line separators", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "agent_start",
        timestamp: 1000,
        agentId: "test\u2028\u2029",
      }),
    ];
    const html = generateStandaloneHTML(events);
    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
  });

  it("escapes HTML in title", () => {
    const html = generateStandaloneHTML([], {
      title: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("respects maxEvents option", () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent({ id: i, type: "agent_start", timestamp: 1000 + i }),
    );
    const html = generateStandaloneHTML(events, { maxEvents: 10 });
    // The JSON should only contain 10 events
    const jsonStr = html.split("var EVENTS = ")[1]!.split(";\n")[0]!;
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveLength(10);
  });

  it("includes COLOR mappings", () => {
    const events = [makeEvent({ id: 1, type: "agent_start", timestamp: 1000 })];
    const html = generateStandaloneHTML(events);
    expect(html).toContain("var COLORS =");
    expect(html).toContain("#3b82f6"); // blue for agent_start
  });

  it("generates self-contained HTML (no external dependencies)", () => {
    const events = [makeEvent({ id: 1, type: "agent_start", timestamp: 1000 })];
    const html = generateStandaloneHTML(events);
    // Should not contain any external script/link references
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="http');
  });

  it("handles special characters in agentId safely", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "agent_start",
        timestamp: 1000,
        agentId: 'agent<"with&special>chars',
      }),
    ];
    // Should not throw
    const html = generateStandaloneHTML(events);
    expect(html).toContain("<!DOCTYPE html>");
    // The agentId is in JSON, so it's safe. But title escaping should work
    expect(html).toBeDefined();
  });

  it("handles very large event data without crashing", () => {
    const bigString = "x".repeat(10_000);
    const events = [
      makeEvent({
        id: 1,
        type: "agent_complete",
        timestamp: 1000,
        output: bigString,
      }),
    ];
    const html = generateStandaloneHTML(events);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html.length).toBeGreaterThan(10_000);
  });

  it("uses DOM-based text escaping in the detail viewer (not innerHTML with user data)", () => {
    const events = [makeEvent({ id: 1, type: "agent_start", timestamp: 1000 })];
    const html = generateStandaloneHTML(events);
    // The detail panel should use createTextNode for user-provided data
    expect(html).toContain("createTextNode");
    // The showDetail function should use textContent, not `.innerHTML =` assignments
    const showDetailSection = html
      .split("function showDetail")[1]!
      .split("})();")[0]!;
    expect(showDetailSection).toContain("textContent");
    // Verify no innerHTML assignments (`.innerHTML =`) in the detail renderer
    // The comment "no innerHTML with user data" is fine — it's the assignments we're guarding against
    const innerHtmlAssignments = showDetailSection.match(/\.innerHTML\s*=/g);
    expect(innerHtmlAssignments).toBeNull();
  });
});

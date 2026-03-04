// Example: goal-heist
// Source: examples/goal-heist/src/agents.ts
// Pure module file — no DOM wiring

import { createRunner } from "@directive-run/ai";
import type { GoalNode } from "@directive-run/ai";

// ---------------------------------------------------------------------------
// API key management (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "goal-heist-api-key";

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

// ---------------------------------------------------------------------------
// Agent metadata
// ---------------------------------------------------------------------------

export interface HeistAgent {
  id: string;
  name: string;
  emoji: string;
  title: string;
  produces: string[];
  requires: string[];
  instruction: string;
  mockResponse: Record<string, unknown>;
  mockDelay: number;
}

export const AGENTS: Record<string, HeistAgent> = {
  gigi: {
    id: "gigi",
    name: "Gigi",
    emoji: "\uD83D\uDC84",
    title: "The Grifter",
    produces: ["guard_schedule"],
    requires: [],
    instruction:
      'You are Gigi "The Grifter", a master of social engineering. You sweet-talked the night guard and obtained their patrol schedule. Respond with JSON: { "guard_schedule": "<brief schedule description>" }',
    mockResponse: {
      guard_schedule:
        "Guards rotate every 45min. East wing unpatrolled 2:15-3:00 AM. Shift change at 3 AM — 4min blind spot.",
    },
    mockDelay: 800,
  },
  felix: {
    id: "felix",
    name: "Felix",
    emoji: "\uD83D\uDD8A\uFE0F",
    title: "The Forger",
    produces: ["blueprints"],
    requires: [],
    instruction:
      'You are Felix "The Forger", an expert document forger. You acquired the museum floor plans from the city records archive. Respond with JSON: { "blueprints": "<brief blueprint description>" }',
    mockResponse: {
      blueprints:
        "Floor plan secured. Vault in sub-basement B2, access via service elevator. Air ducts too narrow — main corridor only.",
    },
    mockDelay: 1000,
  },
  vince: {
    id: "vince",
    name: "Vince",
    emoji: "\uD83D\uDE97",
    title: "The Wheelman",
    produces: ["escape_route"],
    requires: [],
    instruction:
      'You are Vince "The Wheelman", the fastest driver in the city. You scouted three escape routes and picked the best one. Respond with JSON: { "escape_route": "<brief route description>" }',
    mockResponse: {
      escape_route:
        "Primary: loading dock → alley → I-90 on-ramp. Backup: north exit → parking garage swap. ETA to safe house: 8 minutes.",
    },
    mockDelay: 600,
  },
  h4x: {
    id: "h4x",
    name: "H4X",
    emoji: "\uD83D\uDCBB",
    title: "The Hacker",
    produces: ["cameras_disabled"],
    requires: ["guard_schedule"],
    instruction:
      'You are H4X "The Hacker". Using the guard schedule, you found the perfect window to loop the security cameras. Respond with JSON: { "cameras_disabled": "<brief description>" }',
    mockResponse: {
      cameras_disabled:
        "Cameras on loop from 2:15 AM. Feed shows empty corridors on repeat. Motion sensors in east wing bypassed.",
    },
    mockDelay: 1200,
  },
  luca: {
    id: "luca",
    name: "Luca",
    emoji: "\uD83D\uDD13",
    title: "The Locksmith",
    produces: ["vault_cracked"],
    requires: ["cameras_disabled", "blueprints"],
    instruction:
      'You are Luca "The Locksmith". With cameras down and blueprints in hand, you cracked the vault. Respond with JSON: { "vault_cracked": "<brief description>" }',
    mockResponse: {
      vault_cracked:
        "Vault open. Biometric bypass took 90 seconds. Package secured. No alarms triggered.",
    },
    mockDelay: 1500,
  },
  ollie: {
    id: "ollie",
    name: "Ollie",
    emoji: "\uD83D\uDC41\uFE0F",
    title: "The Lookout",
    produces: ["all_clear"],
    requires: ["vault_cracked", "escape_route"],
    instruction:
      'You are Ollie "The Lookout". The vault is cracked and the escape route is ready. Confirm all clear for extraction. Respond with JSON: { "all_clear": "<brief confirmation>" }',
    mockResponse: {
      all_clear:
        "All clear. No police activity within 2 miles. Team converging on loading dock. Go go go.",
    },
    mockDelay: 700,
  },
};

// Ordered list for rendering
export const AGENT_ORDER = ["gigi", "felix", "vince", "h4x", "luca", "ollie"];

// ---------------------------------------------------------------------------
// Satisfaction weights
// ---------------------------------------------------------------------------

export const WEIGHTS: Record<string, number> = {
  guard_schedule: 0.1,
  blueprints: 0.1,
  escape_route: 0.05,
  cameras_disabled: 0.2,
  vault_cracked: 0.35,
  all_clear: 0.2,
};

export function computeSatisfaction(facts: Record<string, unknown>): number {
  let score = 0;

  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (facts[key] != null) {
      score += weight;
    }
  }

  return Math.min(score, 1);
}

// ---------------------------------------------------------------------------
// Goal nodes (used by runGoal)
// ---------------------------------------------------------------------------

export function buildGoalNodes(): Record<string, GoalNode> {
  const nodes: Record<string, GoalNode> = {};

  for (const agent of Object.values(AGENTS)) {
    nodes[agent.id] = {
      agent: agent.id,
      produces: agent.produces,
      requires: agent.requires.length > 0 ? agent.requires : undefined,
      buildInput: (facts) => {
        const relevantFacts: Record<string, unknown> = {};

        for (const key of agent.requires) {
          if (facts[key] != null) {
            relevantFacts[key] = facts[key];
          }
        }

        return JSON.stringify(relevantFacts);
      },
      extractOutput: (result) => {
        try {
          const parsed =
            typeof result.output === "string"
              ? JSON.parse(result.output)
              : result.output;
          const extracted: Record<string, unknown> = {};

          for (const key of agent.produces) {
            if (parsed[key] != null) {
              extracted[key] = parsed[key];
            }
          }

          return extracted;
        } catch {
          return {};
        }
      },
    };
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Runner factory (real Claude or mock)
// ---------------------------------------------------------------------------

export function createHeistRunner(apiKey: string | null) {
  if (apiKey) {
    return createRunner({
      buildRequest: (agent, input) => ({
        url: "/api/claude",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            system: agent.instructions ?? "",
            messages: [{ role: "user", content: input }],
          }),
        },
      }),
      parseResponse: async (res) => {
        const data = await res.json();
        const text = data.content?.[0]?.text ?? "";
        const inputTokens = data.usage?.input_tokens ?? 0;
        const outputTokens = data.usage?.output_tokens ?? 0;

        return {
          text,
          totalTokens: inputTokens + outputTokens,
        };
      },
      parseOutput: (text) => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      },
    });
  }

  // Mock runner — configurable delays, supports failure injection
  return createMockRunner();
}

// ---------------------------------------------------------------------------
// Mock runner with failure injection
// ---------------------------------------------------------------------------

let failHacker = false;
let failForger = false;
let hackerFailCount = 0;

export function setFailHacker(v: boolean): void {
  failHacker = v;
  hackerFailCount = 0;
}

export function setFailForger(v: boolean): void {
  failForger = v;
}

function createMockRunner() {
  return createRunner({
    buildRequest: (agent, input) => ({
      url: "mock://local",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agent.name, input }),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "";
      const tokens = data.usage?.total_tokens ?? 0;

      return { text, totalTokens: tokens };
    },
    parseOutput: (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    // Mock fetch — adds delay, failure injection, returns Anthropic-shaped response
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const agentName = (body.agent as string)?.toLowerCase() ?? "";

      const agentDef = Object.values(AGENTS).find(
        (a) => a.name.toLowerCase() === agentName,
      );
      const delay = agentDef?.mockDelay ?? 800;

      await new Promise((resolve) => setTimeout(resolve, delay));

      // Failure injection
      if (agentName === "h4x" && failHacker) {
        hackerFailCount++;

        if (hackerFailCount <= 3) {
          return new Response(
            JSON.stringify({ error: "Firewall upgraded! Intrusion detected." }),
            { status: 500 },
          );
        }
      }

      if (agentName === "felix" && failForger) {
        return new Response(
          JSON.stringify({ error: "Felix arrested at the archive!" }),
          { status: 500 },
        );
      }

      const mockResp = agentDef?.mockResponse ?? {};
      const tokens = Math.floor(Math.random() * 40) + 20;

      const responseBody = {
        content: [{ text: JSON.stringify(mockResp) }],
        usage: { total_tokens: tokens },
      };

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

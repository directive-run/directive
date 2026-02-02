/**
 * Traffic Light Example
 *
 * Demonstrates core Directive concepts:
 * - Facts: The state of the system (phase, elapsed time)
 * - Derivations: Computed values (isRed, isGreen, isYellow, canWalk)
 * - Constraints: Declare what must be true (when to transition)
 * - Resolvers: How to fulfill requirements (execute transitions)
 * - Events: External inputs (tick, manual override)
 *
 * This is a standalone example with no external dependencies.
 */

import { createModule, createSystem, t, forType } from "directive";
import { loggingPlugin } from "directive/plugins";

// ============================================================================
// Types
// ============================================================================

type Phase = "red" | "green" | "yellow";

interface TransitionRequirement {
  type: "TRANSITION";
  to: Phase;
}

// ============================================================================
// Configuration
// ============================================================================

const PHASE_DURATIONS: Record<Phase, number> = {
  red: 30, // 30 seconds red
  green: 25, // 25 seconds green
  yellow: 5, // 5 seconds yellow
};

const PHASE_SEQUENCE: Record<Phase, Phase> = {
  red: "green",
  green: "yellow",
  yellow: "red",
};

// ============================================================================
// Module Definition
// ============================================================================

const trafficLightModule = createModule("traffic-light", {
  // Schema defines the shape of our facts
  schema: {
    phase: t.string<Phase>(),
    elapsed: t.number(),
    manualOverride: t.boolean(),
  },

  // Initialize facts on system start
  init: (facts) => {
    facts.phase = "red";
    facts.elapsed = 0;
    facts.manualOverride = false;
  },

  // Events are external inputs that modify facts
  events: {
    // Called every second to advance time
    tick: (facts) => {
      if (!facts.manualOverride) {
        facts.elapsed += 1;
      }
    },

    // Manual phase override (e.g., for emergency vehicles)
    setPhase: (facts, event) => {
      const phase = event.phase as Phase;
      facts.phase = phase;
      facts.elapsed = 0;
      facts.manualOverride = true;
    },

    // Resume automatic operation
    resume: (facts) => {
      facts.manualOverride = false;
      facts.elapsed = 0;
    },
  },

  // Derivations are computed values (auto-tracked, no deps array needed)
  derive: {
    // Simple boolean derivations
    isRed: (facts) => facts.phase === "red",
    isGreen: (facts) => facts.phase === "green",
    isYellow: (facts) => facts.phase === "yellow",

    // Computed from phase
    canWalk: (facts) => facts.phase === "red",

    // Time remaining in current phase
    timeRemaining: (facts) => {
      const duration = PHASE_DURATIONS[facts.phase];
      return Math.max(0, duration - facts.elapsed);
    },

    // Progress through current phase (0-1)
    progress: (facts) => {
      const duration = PHASE_DURATIONS[facts.phase];
      return Math.min(1, facts.elapsed / duration);
    },

    // Composite derivation using other derivations
    status: (facts, derive) => ({
      phase: facts.phase,
      isRed: derive.isRed,
      canWalk: derive.canWalk,
      timeRemaining: derive.timeRemaining,
      progress: derive.progress,
      isAutomatic: !facts.manualOverride,
    }),
  },

  // Constraints declare WHEN something should happen
  constraints: {
    // When elapsed time exceeds phase duration, transition to next phase
    shouldTransition: {
      priority: 10, // Higher priority than other constraints
      when: (facts) => {
        if (facts.manualOverride) return false;
        const duration = PHASE_DURATIONS[facts.phase];
        return facts.elapsed >= duration;
      },
      require: (facts) => ({
        type: "TRANSITION" as const,
        to: PHASE_SEQUENCE[facts.phase],
      }),
    },
  },

  // Resolvers declare HOW to fulfill requirements
  resolvers: {
    transition: {
      // Type guard to match requirements this resolver handles
      handles: forType<TransitionRequirement>("TRANSITION"),

      // Custom key for deduplication (prevents duplicate transitions)
      key: (req) => `transition-to-${req.to}`,

      // The actual resolution logic
      resolve: async (req, ctx) => {
        // Transition to new phase
        ctx.facts.phase = req.to;
        ctx.facts.elapsed = 0;

        // Log the transition
        console.log(`\n🚦 Light changed to ${req.to.toUpperCase()}`);
      },
    },
  },

  // Lifecycle hooks
  hooks: {
    onStart: () => {
      console.log("🚦 Traffic light started");
    },
    onStop: () => {
      console.log("🚦 Traffic light stopped");
    },
  },
});

// ============================================================================
// System Creation
// ============================================================================

const system = createSystem({
  modules: [trafficLightModule],
  plugins: [
    loggingPlugin({
      logFacts: false, // Don't log every fact change
      logConstraints: true,
      logResolvers: true,
    }),
  ],
  debug: {
    timeTravel: true,
    maxSnapshots: 50,
  },
});

// ============================================================================
// Demo: Run the Traffic Light
// ============================================================================

async function runDemo() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("             DIRECTIVE TRAFFIC LIGHT DEMO");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log();

  // Start the system
  system.start();

  // Display initial state
  console.log("📊 Initial State:");
  console.log(`   Phase: ${system.facts.phase}`);
  console.log(`   Can Walk: ${system.read("canWalk")}`);
  console.log(`   Time Remaining: ${system.read("timeRemaining")}s`);
  console.log();

  // Simulate time passing with tick events
  console.log("⏱️  Simulating 70 seconds of operation...\n");

  for (let second = 1; second <= 70; second++) {
    // Dispatch tick event
    system.dispatch({ type: "tick" });

    // Wait for any resolvers to complete
    await system.settle();

    // Show status every 5 seconds or on phase change
    if (second % 5 === 0) {
      const status = system.read<{
        phase: Phase;
        timeRemaining: number;
        progress: number;
      }>("status");

      console.log(
        `   [${second}s] Phase: ${status.phase.padEnd(6)} | ` +
          `Remaining: ${String(status.timeRemaining).padStart(2)}s | ` +
          `Progress: ${(status.progress * 100).toFixed(0)}%`
      );
    }

    // Small delay for demo visibility (comment out for instant run)
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  console.log();

  // Demonstrate manual override
  console.log("🚨 Emergency vehicle approaching - manual override to GREEN");
  system.dispatch({ type: "setPhase", phase: "green" });
  await system.settle();

  console.log(`   Phase is now: ${system.facts.phase}`);
  console.log(`   Manual override: ${system.facts.manualOverride}`);
  console.log();

  // Resume automatic operation
  console.log("✅ Emergency passed - resuming automatic operation");
  system.dispatch({ type: "resume" });
  await system.settle();

  console.log(`   Phase: ${system.facts.phase}`);
  console.log(`   Manual override: ${system.facts.manualOverride}`);
  console.log();

  // Demonstrate inspection
  console.log("🔍 System Inspection:");
  const inspection = system.inspect();
  console.log(`   Unmet requirements: ${inspection.unmet.length}`);
  console.log(`   Inflight resolvers: ${inspection.inflight.length}`);
  console.log(`   Active constraints: ${inspection.constraints.filter((c) => c.active).length}`);
  console.log();

  // Demonstrate time-travel (if enabled)
  if (system.debug) {
    console.log("⏪ Time Travel Debug:");
    console.log(`   Snapshots captured: ${system.debug.snapshots.length}`);
    console.log(`   Current index: ${system.debug.currentIndex}`);

    // Go back 5 snapshots
    if (system.debug.snapshots.length > 5) {
      system.debug.goBack(5);
      console.log(`   After going back 5: phase = ${system.facts.phase}`);
      system.debug.goForward(5);
      console.log(`   After going forward 5: phase = ${system.facts.phase}`);
    }
  }
  console.log();

  // Clean up
  system.destroy();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                      DEMO COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
}

// Run the demo
runDemo().catch(console.error);

// ============================================================================
// Export for use as a module
// ============================================================================

export { trafficLightModule, system, PHASE_DURATIONS, PHASE_SEQUENCE };
export type { Phase, TransitionRequirement };

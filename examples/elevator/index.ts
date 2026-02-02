/**
 * Elevator Example - Multi-Elevator Coordination
 *
 * Demonstrates:
 * - XState for individual elevator behavior (state machines)
 * - Directive for multi-elevator coordination (constraints)
 */

import { createActor } from "xstate";
import {
  createActorCoordinator,
  isInState,
  isActive,
} from "directive/xstate";
import { createElevatorMachine } from "./machine.js";
import type {
  ElevatorState,
  FloorRequest,
  Direction,
  DispatchElevatorRequirement,
} from "./types.js";

// ============================================================================
// Types for Directive Facts
// ============================================================================

interface BuildingFacts {
  floorRequests: FloorRequest[];
  numFloors: number;
}

// ============================================================================
// Elevator Coordination with Directive
// ============================================================================

const NUM_ELEVATORS = 2;
const NUM_FLOORS = 10;

// Create elevator machines
const elevatorMachines = Array.from({ length: NUM_ELEVATORS }, (_, i) => ({
  id: `elevator-${i + 1}`,
  machine: createElevatorMachine(`${i + 1}`, i === 0 ? 1 : 5), // Start at different floors
}));

/**
 * Create the elevator coordinator.
 *
 * This coordinates multiple XState elevator machines using Directive constraints.
 */
export const coordinator = createActorCoordinator<BuildingFacts>({
  actors: elevatorMachines,
  createActor,

  factsSchema: {
    floorRequests: { _type: [] as FloorRequest[], _validators: [] },
    numFloors: { _type: NUM_FLOORS, _validators: [] },
  },

  init: (facts) => {
    facts.floorRequests = [];
    facts.numFloors = NUM_FLOORS;
  },

  constraints: {
    // When there's a floor request and no elevator is responding → dispatch one
    dispatchElevator: {
      priority: 10,
      when: (facts) => {
        if (facts.floorRequests.length === 0) return false;

        // Check if any elevator is already heading to the requested floor
        const request = facts.floorRequests[0];
        for (const [id, state] of Object.entries(facts.actors)) {
          // If elevator is already going to this floor
          if (
            isActive(state) &&
            isInState(state, ["moving", "arriving"]) &&
            state.value === request.floor
          ) {
            return false;
          }
        }

        return true;
      },
      require: (facts): DispatchElevatorRequirement => {
        const request = facts.floorRequests[0];
        return {
          type: "DISPATCH_ELEVATOR",
          floor: request.floor,
          direction: request.direction,
        };
      },
    },
  },

  resolvers: {
    dispatch: {
      handles: (req): req is DispatchElevatorRequirement =>
        req.type === "DISPATCH_ELEVATOR",
      key: (req) => `dispatch-${req.floor}-${req.direction}`,
      resolve: async (req, { actors, facts }) => {
        // Find the best elevator to dispatch
        const bestElevator = findBestElevator(
          Object.entries(facts.actors).map(([id, state]) => ({
            id,
            currentFloor: typeof state.value === "object"
              ? 1 // Default if complex state
              : parseInt(String(state.value).split("-").pop() || "1"),
            isIdle: isInState(state, "idle"),
          })),
          req.floor,
          req.direction
        );

        if (bestElevator) {
          console.log(
            `\n🛗 Dispatching ${bestElevator} to floor ${req.floor} (${req.direction})`
          );
          actors[bestElevator].send({ type: "GO_TO_FLOOR", floor: req.floor });

          // Remove the request from queue
          facts.floorRequests = facts.floorRequests.filter(
            (r) => r.floor !== req.floor || r.direction !== req.direction
          );
        }
      },
    },
  },

  debug: true,
});

/**
 * Find the best elevator to handle a request.
 *
 * Strategy:
 * 1. Prefer idle elevators
 * 2. Prefer elevators moving in the same direction
 * 3. Prefer closest elevator
 */
function findBestElevator(
  elevators: Array<{ id: string; currentFloor: number; isIdle: boolean }>,
  targetFloor: number,
  direction: Direction
): string | null {
  let best: { id: string; score: number } | null = null;

  for (const elevator of elevators) {
    let score = 0;

    // Distance penalty
    const distance = Math.abs(elevator.currentFloor - targetFloor);
    score -= distance * 10;

    // Idle bonus
    if (elevator.isIdle) {
      score += 50;
    }

    if (!best || score > best.score) {
      best = { id: elevator.id, score };
    }
  }

  return best?.id ?? null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Request an elevator to a floor.
 */
export function requestElevator(floor: number, direction: Direction = "up"): void {
  const request: FloorRequest = {
    floor,
    direction,
    requestedAt: Date.now(),
  };

  coordinator.facts.floorRequests = [
    ...coordinator.facts.floorRequests,
    request,
  ];

  console.log(`\n📢 Floor ${floor} requested (${direction})`);
}

/**
 * Get current state of all elevators.
 */
export function getElevatorStates(): Array<{ id: string; floor: number; status: string }> {
  return Object.entries(coordinator.facts.actors).map(([id, state]) => ({
    id,
    floor: 1, // Would extract from actor context in real impl
    status: state.status,
  }));
}

// ============================================================================
// Demo
// ============================================================================

async function runDemo() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("          DIRECTIVE + XSTATE ELEVATOR DEMO");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log();
  console.log(`Building: ${NUM_FLOORS} floors, ${NUM_ELEVATORS} elevators`);
  console.log();

  // Start the coordinator
  coordinator.start();

  // Wait a moment for initialization
  await new Promise((r) => setTimeout(r, 500));

  // Simulate floor requests
  console.log("📍 Simulating floor requests...\n");

  requestElevator(5, "up");
  await new Promise((r) => setTimeout(r, 2000));

  requestElevator(8, "down");
  await new Promise((r) => setTimeout(r, 2000));

  requestElevator(1, "up");
  await new Promise((r) => setTimeout(r, 3000));

  // Request same floor twice (should be deduplicated)
  requestElevator(3, "up");
  requestElevator(3, "up");
  await new Promise((r) => setTimeout(r, 5000));

  // Show final state
  console.log("\n📊 Final State:");
  console.log("Pending requests:", coordinator.facts.floorRequests.length);
  console.log("Elevators:", Object.keys(coordinator.facts.actors).length);

  // Inspect Directive system
  const inspection = coordinator.system.inspect();
  console.log("\n🔍 Directive Inspection:");
  console.log("  Unmet requirements:", inspection.unmet.length);
  console.log("  Inflight resolvers:", inspection.inflight.length);

  // Clean up
  await new Promise((r) => setTimeout(r, 2000));
  coordinator.destroy();

  console.log();
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                      DEMO COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
}

// Run if executed directly
runDemo().catch(console.error);

export { coordinator as elevatorCoordinator };

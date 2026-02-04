/**
 * Traffic Intersection - Comprehensive Directive Example
 *
 * This example demonstrates ALL of Directive's features:
 * - Schema: Typed state with consolidated type definitions
 * - Derivations: Computed values that auto-track dependencies
 * - Effects: Side effects that run when state changes
 * - Constraints: Rules that produce requirements when conditions are met
 * - Resolvers: Async handlers that fulfill requirements
 * - Events: Type-safe event handling with payloads
 * - Plugins: Extensibility for logging, debugging, persistence
 * - Priority: Emergency vehicles override normal operation
 * - Time-Travel: Debug by stepping through state history
 */

import {
  createModule,
  createSystem,
  t,
  type Plugin,
} from "directive";

// ============================================================================
// Types
// ============================================================================

/** Traffic light phase */
export type LightPhase = "green" | "yellow" | "red";

/** Direction for cars and pedestrians */
export type Direction = "north" | "south" | "east" | "west";

/** Axis of the intersection */
export type Axis = "NS" | "EW";

/** Car waiting at intersection */
export interface Car {
  id: string;
  arrivedAt: number;
  direction: Direction;
}

/** Pedestrian crossing request */
export interface PedestrianRequest {
  id: string;
  crosswalk: Axis;
  requestedAt: number;
}

/** Intersection status summary */
export interface IntersectionStatus {
  ns: LightPhase;
  ew: LightPhase;
  emergency: boolean;
  carsWaiting: number;
  pedestriansWaiting: number;
}

// ============================================================================
// Schema Definition (Single Source of Truth)
// ============================================================================

const schema = {
  facts: {
    // Light phases for each axis
    nsPhase: t.string<LightPhase>(),
    ewPhase: t.string<LightPhase>(),

    // Timing
    phaseStartedAt: t.number(),
    currentTime: t.number(),

    // Car queues at each direction
    northQueue: t.array<Car>(),
    southQueue: t.array<Car>(),
    eastQueue: t.array<Car>(),
    westQueue: t.array<Car>(),

    // Pedestrian requests
    pedestrianRequests: t.array<PedestrianRequest>(),

    // Emergency mode
    emergencyActive: t.boolean(),
    emergencyDirection: t.string<Direction>(),

    // Statistics
    totalCarsPassed: t.number(),
    totalPedestriansCrossed: t.number(),

    // Configuration
    greenDuration: t.number(),
    yellowDuration: t.number(),
    pedestrianDuration: t.number(),
  },

  derivations: {
    totalCarsWaiting: t.number(),
    nsCarsWaiting: t.number(),
    ewCarsWaiting: t.number(),
    isBusy: t.boolean(),
    canCrossNS: t.boolean(),
    canCrossEW: t.boolean(),
    phaseElapsed: t.number(),
    phaseProgress: t.number(),
    hasPedestrianRequests: t.boolean(),
    status: t.any<IntersectionStatus>(),
  },

  events: {},

  requirements: {
    TRANSITION: {
      from: t.string<LightPhase>(),
      to: t.string<LightPhase>(),
      axis: t.string<Axis>(),
    },
    EMERGENCY_MODE: {
      direction: t.string<Direction>(),
      active: t.boolean(),
    },
    PEDESTRIAN_CROSSING: {
      crosswalk: t.string<Axis>(),
      requestId: t.string(),
    },
  },
};

type IntersectionSchema = typeof schema;

// ============================================================================
// Module Definition
// ============================================================================

export const intersectionModule = createModule("traffic-intersection", {
  schema,

  // ----------------------------------------
  // Initialization
  // ----------------------------------------
  init: (facts) => {
    // Start with NS green, EW red
    facts.nsPhase = "green";
    facts.ewPhase = "red";

    // Timing
    facts.phaseStartedAt = Date.now();
    facts.currentTime = Date.now();

    // Empty queues
    facts.northQueue = [];
    facts.southQueue = [];
    facts.eastQueue = [];
    facts.westQueue = [];

    // No pedestrian requests
    facts.pedestrianRequests = [];

    // No emergency (placeholder direction, only used when emergencyActive)
    facts.emergencyActive = false;
    facts.emergencyDirection = "north";

    // Statistics
    facts.totalCarsPassed = 0;
    facts.totalPedestriansCrossed = 0;

    // Configuration (in ms)
    facts.greenDuration = 10000; // 10 seconds
    facts.yellowDuration = 3000; // 3 seconds
    facts.pedestrianDuration = 15000; // 15 seconds for pedestrians
  },

  // ----------------------------------------
  // Derivations (computed values)
  // ----------------------------------------
  derive: {
    // Total cars waiting at intersection
    totalCarsWaiting: (facts) =>
      facts.northQueue.length +
      facts.southQueue.length +
      facts.eastQueue.length +
      facts.westQueue.length,

    // Cars waiting on each axis
    nsCarsWaiting: (facts) => facts.northQueue.length + facts.southQueue.length,
    ewCarsWaiting: (facts) => facts.eastQueue.length + facts.westQueue.length,

    // Is the intersection busy?
    isBusy: (facts) =>
      facts.northQueue.length +
        facts.southQueue.length +
        facts.eastQueue.length +
        facts.westQueue.length >
      5,

    // Can cars cross on each axis?
    canCrossNS: (facts) => facts.nsPhase === "green" && !facts.emergencyActive,
    canCrossEW: (facts) => facts.ewPhase === "green" && !facts.emergencyActive,

    // Time in current phase
    phaseElapsed: (facts) => facts.currentTime - facts.phaseStartedAt,

    // Phase progress (0-1)
    phaseProgress: (facts) => {
      const elapsed = facts.currentTime - facts.phaseStartedAt;
      const activePhase = facts.nsPhase !== "red" ? facts.nsPhase : facts.ewPhase;
      const duration =
        activePhase === "yellow" ? facts.yellowDuration : facts.greenDuration;
      return Math.min(1, elapsed / duration);
    },

    // Has pending pedestrian requests
    hasPedestrianRequests: (facts) => facts.pedestrianRequests.length > 0,

    // Intersection status summary
    status: (facts) => ({
      ns: facts.nsPhase,
      ew: facts.ewPhase,
      emergency: facts.emergencyActive,
      carsWaiting:
        facts.northQueue.length +
        facts.southQueue.length +
        facts.eastQueue.length +
        facts.westQueue.length,
      pedestriansWaiting: facts.pedestrianRequests.length,
    }),
  },

  // ----------------------------------------
  // Events (none for this example)
  // ----------------------------------------
  events: {},

  // ----------------------------------------
  // Effects (side effects on state change)
  // ----------------------------------------
  effects: {
    // Log phase changes
    logPhaseChange: {
      run: (facts) => {
        // Log current phase on each update
        console.log(`[Phase] NS=${facts.nsPhase}, EW=${facts.ewPhase}`);
      },
    },

    // Log emergency mode
    logEmergency: {
      run: (facts) => {
        if (facts.emergencyActive) {
          console.log(`[EMERGENCY] Active - ${facts.emergencyDirection}`);
        }
      },
    },
  },

  // ----------------------------------------
  // Constraints (rules that produce requirements)
  // ----------------------------------------
  constraints: {
    // PRIORITY 100: Emergency vehicle override
    emergencyOverride: {
      priority: 100,
      when: (facts) => {
        if (!facts.emergencyActive) return false;

        // Need to change lights for emergency vehicle
        const dir = facts.emergencyDirection;
        const needsNSGreen = dir === "north" || dir === "south";
        const needsEWGreen = dir === "east" || dir === "west";

        if (needsNSGreen && facts.nsPhase !== "green") return true;
        if (needsEWGreen && facts.ewPhase !== "green") return true;

        return false;
      },
      require: (facts) => ({
        type: "EMERGENCY_MODE" as const,
        direction: facts.emergencyDirection as Direction,
        active: true,
      }),
    },

    // PRIORITY 50: Normal NS green -> yellow transition
    nsGreenToYellow: {
      priority: 50,
      when: (facts) => {
        if (facts.emergencyActive) return false;
        if (facts.nsPhase !== "green") return false;

        const elapsed = facts.currentTime - facts.phaseStartedAt;
        return elapsed >= facts.greenDuration;
      },
      require: {
        type: "TRANSITION" as const,
        from: "green" as LightPhase,
        to: "yellow" as LightPhase,
        axis: "NS" as Axis,
      },
    },

    // PRIORITY 50: Normal EW green -> yellow transition
    ewGreenToYellow: {
      priority: 50,
      when: (facts) => {
        if (facts.emergencyActive) return false;
        if (facts.ewPhase !== "green") return false;

        const elapsed = facts.currentTime - facts.phaseStartedAt;
        return elapsed >= facts.greenDuration;
      },
      require: {
        type: "TRANSITION" as const,
        from: "green" as LightPhase,
        to: "yellow" as LightPhase,
        axis: "EW" as Axis,
      },
    },

    // PRIORITY 60: Yellow -> red transitions (higher priority than green->yellow)
    nsYellowToRed: {
      priority: 60,
      when: (facts) => {
        if (facts.nsPhase !== "yellow") return false;

        const elapsed = facts.currentTime - facts.phaseStartedAt;
        return elapsed >= facts.yellowDuration;
      },
      require: {
        type: "TRANSITION" as const,
        from: "yellow" as LightPhase,
        to: "red" as LightPhase,
        axis: "NS" as Axis,
      },
    },

    ewYellowToRed: {
      priority: 60,
      when: (facts) => {
        if (facts.ewPhase !== "yellow") return false;

        const elapsed = facts.currentTime - facts.phaseStartedAt;
        return elapsed >= facts.yellowDuration;
      },
      require: {
        type: "TRANSITION" as const,
        from: "yellow" as LightPhase,
        to: "red" as LightPhase,
        axis: "EW" as Axis,
      },
    },

    // PRIORITY 40: Pedestrian crossing requests
    pedestrianNS: {
      priority: 40,
      when: (facts) => {
        if (facts.emergencyActive) return false;

        // Find NS pedestrian requests that haven't been handled
        const nsRequest = facts.pedestrianRequests.find((r) => r.crosswalk === "NS");
        if (!nsRequest) return false;

        // Can cross when EW is green (pedestrians cross parallel to car flow)
        // Wait for the light to be green for a bit
        if (facts.ewPhase !== "green") return false;

        const elapsed = facts.currentTime - facts.phaseStartedAt;
        return elapsed >= 2000; // Wait 2 seconds into green
      },
      require: (facts) => {
        const request = facts.pedestrianRequests.find((r) => r.crosswalk === "NS");
        return {
          type: "PEDESTRIAN_CROSSING" as const,
          crosswalk: "NS" as Axis,
          requestId: request?.id ?? "",
        };
      },
    },

    pedestrianEW: {
      priority: 40,
      when: (facts) => {
        if (facts.emergencyActive) return false;

        const ewRequest = facts.pedestrianRequests.find((r) => r.crosswalk === "EW");
        if (!ewRequest) return false;

        if (facts.nsPhase !== "green") return false;

        const elapsed = facts.currentTime - facts.phaseStartedAt;
        return elapsed >= 2000;
      },
      require: (facts) => {
        const request = facts.pedestrianRequests.find((r) => r.crosswalk === "EW");
        return {
          type: "PEDESTRIAN_CROSSING" as const,
          crosswalk: "EW" as Axis,
          requestId: request?.id ?? "",
        };
      },
    },
  },

  // ----------------------------------------
  // Resolvers (handle requirements)
  // ----------------------------------------
  resolvers: {
    // Handle phase transitions
    handleTransition: {
      requirement: "TRANSITION",
      resolve: async (req, ctx) => {
        const { axis, to } = req;

        console.log(`[Resolver] Transitioning ${axis} to ${to}`);

        if (axis === "NS") {
          ctx.facts.nsPhase = to;

          // When NS goes red, EW goes green
          if (to === "red") {
            ctx.facts.ewPhase = "green";
          }
        } else {
          ctx.facts.ewPhase = to;

          // When EW goes red, NS goes green
          if (to === "red") {
            ctx.facts.nsPhase = "green";
          }
        }

        ctx.facts.phaseStartedAt = ctx.facts.currentTime;
      },
    },

    // Handle emergency mode
    handleEmergency: {
      requirement: "EMERGENCY_MODE",
      resolve: async (req, ctx) => {
        const { direction } = req;
        const needsNSGreen = direction === "north" || direction === "south";

        console.log(
          `[Resolver] Emergency mode - clearing path for ${direction} (${needsNSGreen ? "NS" : "EW"} green)`
        );

        // Immediately set appropriate lights
        if (needsNSGreen) {
          ctx.facts.nsPhase = "green";
          ctx.facts.ewPhase = "red";
        } else {
          ctx.facts.nsPhase = "red";
          ctx.facts.ewPhase = "green";
        }

        ctx.facts.phaseStartedAt = ctx.facts.currentTime;
      },
    },

    // Handle pedestrian crossing
    handlePedestrianCrossing: {
      requirement: "PEDESTRIAN_CROSSING",
      resolve: async (req, ctx) => {
        const { requestId } = req;
        console.log(`[Resolver] Pedestrian crossing (${requestId})`);

        // Simulate crossing time
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Remove the request
        ctx.facts.pedestrianRequests = ctx.facts.pedestrianRequests.filter(
          (r) => r.id !== requestId
        );
        ctx.facts.totalPedestriansCrossed += 1;
      },
    },
  },
});

// ============================================================================
// Logging Plugin
// ============================================================================

export function createLoggingPlugin(): Plugin {
  return {
    name: "intersection-logging",

    onRequirementCreated: (req) => {
      console.log(`[Plugin] Requirement created: ${req.requirement.type}`, req.requirement);
    },

    onRequirementMet: (req) => {
      console.log(`[Plugin] Requirement resolved: ${req.requirement.type}`);
    },

    onError: (error) => {
      console.error(`[Plugin] Error:`, error);
    },
  };
}

// ============================================================================
// System Factory
// ============================================================================

// Type alias for facts from schema
type IntersectionFacts = typeof intersectionModule extends { schema: { facts: infer F } }
  ? { [K in keyof F]: F[K] extends { _type: infer T } ? T : never }
  : never;

export interface IntersectionSystem {
  system: ReturnType<typeof createSystem>;
  start: () => void;
  stop: () => void;
  tick: () => void;
  addCar: (direction: Direction) => void;
  removeCar: (direction: Direction) => void;
  requestPedestrianCrossing: (crosswalk: Axis) => void;
  triggerEmergency: (direction: Direction) => void;
  clearEmergency: () => void;
  reset: () => void;
  getState: () => {
    nsPhase: LightPhase;
    ewPhase: LightPhase;
    queues: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
    pedestrianRequests: number;
    emergency: boolean;
    emergencyDirection: Direction | null;
    stats: {
      carsPassed: number;
      pedestriansCrossed: number;
    };
  };
}

export function createIntersection(options?: {
  debug?: boolean;
  greenDuration?: number;
  yellowDuration?: number;
}): IntersectionSystem {
  const { debug = false, greenDuration, yellowDuration } = options ?? {};

  const system = createSystem({
    module: intersectionModule,
    plugins: debug ? [createLoggingPlugin()] : [],
    debug: debug ? { timeTravel: true, maxSnapshots: 100 } : undefined,
    // Use initialFacts to set configuration before system starts
    initialFacts: {
      ...(greenDuration && { greenDuration }),
      ...(yellowDuration && { yellowDuration }),
    },
  });

  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let carCounter = 0;

  // Alias for cleaner access
  const facts = system.facts;

  // Helper to get queue by direction
  const getQueue = (direction: Direction): Car[] => {
    switch (direction) {
      case "north": return facts.northQueue;
      case "south": return facts.southQueue;
      case "east": return facts.eastQueue;
      case "west": return facts.westQueue;
    }
  };

  const setQueue = (direction: Direction, queue: Car[]) => {
    switch (direction) {
      case "north": facts.northQueue = queue; break;
      case "south": facts.southQueue = queue; break;
      case "east": facts.eastQueue = queue; break;
      case "west": facts.westQueue = queue; break;
    }
  };

  return {
    system,

    start: () => {
      system.start();
      // Start ticking every 100ms
      tickInterval = setInterval(() => {
        facts.currentTime = Date.now();
      }, 100);
    },

    stop: () => {
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      system.stop();
    },

    tick: () => {
      facts.currentTime = Date.now();
    },

    addCar: (direction: Direction) => {
      carCounter++;
      const car: Car = {
        id: `car-${carCounter}`,
        arrivedAt: facts.currentTime,
        direction,
      };
      setQueue(direction, [...getQueue(direction), car]);
      console.log(`[Event] Car ${car.id} arrived from ${direction}`);
    },

    removeCar: (direction: Direction) => {
      const queue = getQueue(direction);
      if (queue.length > 0) {
        const [car, ...rest] = queue;
        setQueue(direction, rest);
        facts.totalCarsPassed += 1;
        console.log(`[Event] Car ${car.id} departed from ${direction}`);
      }
    },

    requestPedestrianCrossing: (crosswalk: Axis) => {
      const request: PedestrianRequest = {
        id: `ped-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        crosswalk,
        requestedAt: facts.currentTime,
      };
      facts.pedestrianRequests = [...facts.pedestrianRequests, request];
      console.log(`[Event] Pedestrian requested to cross ${crosswalk} crosswalk`);
    },

    triggerEmergency: (direction: Direction) => {
      facts.emergencyActive = true;
      facts.emergencyDirection = direction;
      console.log(`[Event] EMERGENCY vehicle approaching from ${direction}!`);
    },

    clearEmergency: () => {
      facts.emergencyActive = false;
      facts.phaseStartedAt = facts.currentTime; // Reset phase timer
      console.log(`[Event] Emergency vehicle cleared`);
    },

    reset: () => {
      facts.nsPhase = "green";
      facts.ewPhase = "red";
      facts.phaseStartedAt = facts.currentTime;
      facts.northQueue = [];
      facts.southQueue = [];
      facts.eastQueue = [];
      facts.westQueue = [];
      facts.pedestrianRequests = [];
      facts.emergencyActive = false;
      console.log(`[Event] Intersection reset`);
    },

    getState: () => ({
      nsPhase: facts.nsPhase,
      ewPhase: facts.ewPhase,
      queues: {
        north: facts.northQueue.length,
        south: facts.southQueue.length,
        east: facts.eastQueue.length,
        west: facts.westQueue.length,
      },
      pedestrianRequests: facts.pedestrianRequests.length,
      emergency: facts.emergencyActive,
      emergencyDirection: facts.emergencyActive ? facts.emergencyDirection as Direction : null,
      stats: {
        carsPassed: facts.totalCarsPassed,
        pedestriansCrossed: facts.totalPedestriansCrossed,
      },
    }),
  };
}

/**
 * XState Machine for Individual Elevator Behavior
 *
 * This machine handles a single elevator's behavior:
 * - Door opening/closing
 * - Moving between floors
 * - Passenger loading/unloading
 */

import { createMachine, assign, type MachineConfig } from "xstate";
import type { ElevatorState, Direction } from "./types.js";

// Events
type ElevatorEvent =
  | { type: "GO_TO_FLOOR"; floor: number }
  | { type: "OPEN_DOORS" }
  | { type: "CLOSE_DOORS" }
  | { type: "DOORS_OPENED" }
  | { type: "DOORS_CLOSED" }
  | { type: "ARRIVED_AT_FLOOR" }
  | { type: "PASSENGER_ENTERED"; count: number }
  | { type: "PASSENGER_EXITED"; count: number }
  | { type: "EMERGENCY_STOP" };

// Context
interface ElevatorContext {
  id: string;
  currentFloor: number;
  targetFloor: number | null;
  direction: Direction;
  passengers: number;
  capacity: number;
}

// Machine definition
export const createElevatorMachine = (id: string, initialFloor: number = 1) => {
  return createMachine(
    {
      id: `elevator-${id}`,
      initial: "idle",
      context: {
        id,
        currentFloor: initialFloor,
        targetFloor: null,
        direction: "idle" as Direction,
        passengers: 0,
        capacity: 10,
      },
      states: {
        idle: {
          on: {
            GO_TO_FLOOR: {
              target: "moving",
              guard: "hasValidFloor",
              actions: "setTarget",
            },
            OPEN_DOORS: "doorsOpening",
          },
        },

        doorsOpening: {
          entry: "logDoorsOpening",
          after: {
            DOOR_TRANSITION_TIME: {
              target: "doorsOpen",
              actions: "setDoorsOpen",
            },
          },
          on: {
            EMERGENCY_STOP: "idle",
          },
        },

        doorsOpen: {
          on: {
            PASSENGER_ENTERED: {
              actions: "addPassenger",
              guard: "hasCapacity",
            },
            PASSENGER_EXITED: {
              actions: "removePassenger",
            },
            CLOSE_DOORS: "doorsClosing",
          },
          after: {
            DOOR_OPEN_TIME: "doorsClosing",
          },
        },

        doorsClosing: {
          entry: "logDoorsClosing",
          after: {
            DOOR_TRANSITION_TIME: [
              {
                target: "moving",
                guard: "hasTarget",
                actions: "setDoorsClosed",
              },
              {
                target: "idle",
                actions: "setDoorsClosed",
              },
            ],
          },
          on: {
            OPEN_DOORS: "doorsOpening", // Obstruction detected
          },
        },

        moving: {
          entry: ["calculateDirection", "logMoving"],
          invoke: {
            id: "moveToFloor",
            src: "moveToFloorService",
            onDone: {
              target: "arriving",
              actions: "updateFloor",
            },
            onError: "idle",
          },
          on: {
            EMERGENCY_STOP: {
              target: "idle",
              actions: "clearTarget",
            },
          },
        },

        arriving: {
          entry: "logArriving",
          always: [
            {
              target: "doorsOpening",
              guard: "atTargetFloor",
              actions: "clearTarget",
            },
            {
              target: "moving",
              guard: "notAtTargetFloor",
            },
          ],
        },

        emergency: {
          on: {
            "": "idle", // Reset from emergency
          },
        },
      },
    },
    {
      guards: {
        hasValidFloor: ({ context, event }) => {
          if (event.type !== "GO_TO_FLOOR") return false;
          return event.floor !== context.currentFloor && event.floor >= 1;
        },
        hasTarget: ({ context }) => context.targetFloor !== null,
        hasCapacity: ({ context }) => context.passengers < context.capacity,
        atTargetFloor: ({ context }) =>
          context.targetFloor !== null &&
          context.currentFloor === context.targetFloor,
        notAtTargetFloor: ({ context }) =>
          context.targetFloor !== null &&
          context.currentFloor !== context.targetFloor,
      },

      actions: {
        setTarget: assign({
          targetFloor: ({ event }) =>
            event.type === "GO_TO_FLOOR" ? event.floor : null,
        }),

        clearTarget: assign({
          targetFloor: null,
          direction: "idle" as Direction,
        }),

        calculateDirection: assign({
          direction: ({ context }) => {
            if (context.targetFloor === null) return "idle";
            return context.targetFloor > context.currentFloor ? "up" : "down";
          },
        }),

        updateFloor: assign({
          currentFloor: ({ context }) => {
            if (context.targetFloor === null) return context.currentFloor;
            const step = context.direction === "up" ? 1 : -1;
            return context.currentFloor + step;
          },
        }),

        addPassenger: assign({
          passengers: ({ context, event }) =>
            event.type === "PASSENGER_ENTERED"
              ? Math.min(context.passengers + event.count, context.capacity)
              : context.passengers,
        }),

        removePassenger: assign({
          passengers: ({ context, event }) =>
            event.type === "PASSENGER_EXITED"
              ? Math.max(context.passengers - event.count, 0)
              : context.passengers,
        }),

        setDoorsOpen: () => console.log("Doors open"),
        setDoorsClosed: () => console.log("Doors closed"),
        logDoorsOpening: ({ context }) =>
          console.log(`[Elevator ${context.id}] Doors opening at floor ${context.currentFloor}`),
        logDoorsClosing: ({ context }) =>
          console.log(`[Elevator ${context.id}] Doors closing`),
        logMoving: ({ context }) =>
          console.log(`[Elevator ${context.id}] Moving ${context.direction} to floor ${context.targetFloor}`),
        logArriving: ({ context }) =>
          console.log(`[Elevator ${context.id}] Arriving at floor ${context.currentFloor}`),
      },

      delays: {
        DOOR_TRANSITION_TIME: 1000, // 1 second to open/close
        DOOR_OPEN_TIME: 3000, // 3 seconds doors stay open
      },

      actors: {
        moveToFloorService: ({ context }) => {
          return new Promise<void>((resolve) => {
            // Simulate floor-to-floor movement time
            setTimeout(resolve, 1500);
          });
        },
      },
    }
  );
};

// Helper to get elevator state from machine context
export function getElevatorState(context: ElevatorContext): ElevatorState {
  return {
    id: context.id,
    currentFloor: context.currentFloor,
    targetFloor: context.targetFloor,
    direction: context.direction,
    doorState: "closed", // Would need to track this separately
    passengers: context.passengers,
    capacity: context.capacity,
  };
}

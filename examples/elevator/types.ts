/**
 * Types for Elevator Example
 */

export type Direction = "up" | "down" | "idle";

export type DoorState = "open" | "closed" | "opening" | "closing";

export interface FloorRequest {
  floor: number;
  direction: Direction;
  requestedAt: number;
}

export interface ElevatorState {
  id: string;
  currentFloor: number;
  targetFloor: number | null;
  direction: Direction;
  doorState: DoorState;
  passengers: number;
  capacity: number;
}

export interface BuildingState {
  floors: number;
  elevators: ElevatorState[];
  floorRequests: FloorRequest[];
}

// Directive requirements
export interface DispatchElevatorRequirement {
  type: "DISPATCH_ELEVATOR";
  floor: number;
  direction: Direction;
}

export interface OpenDoorsRequirement {
  type: "OPEN_DOORS";
  elevatorId: string;
}

export interface CloseDoorsRequirement {
  type: "CLOSE_DOORS";
  elevatorId: string;
}

export interface MoveElevatorRequirement {
  type: "MOVE_ELEVATOR";
  elevatorId: string;
  targetFloor: number;
}

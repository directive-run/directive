/**
 * Traffic Intersection - Main Entry Point
 *
 * Sets up the intersection system and binds it to the UI.
 */

import { createIntersection, type Direction, type Axis, type LightPhase } from "./intersection";

// ============================================================================
// Create the Intersection System
// ============================================================================

const intersection = createIntersection({
  debug: true,
  greenDuration: 8000, // 8 seconds for demo
  yellowDuration: 2000, // 2 seconds
});

// Make it globally available for debugging
(window as any).intersection = intersection;

// ============================================================================
// UI Bindings
// ============================================================================

// DOM Elements
const elements = {
  // Traffic lights
  nsLight: document.getElementById("ns-light")!,
  ewLight: document.getElementById("ew-light")!,

  // Car queues
  northQueue: document.getElementById("north-queue")!,
  southQueue: document.getElementById("south-queue")!,
  eastQueue: document.getElementById("east-queue")!,
  westQueue: document.getElementById("west-queue")!,

  // Add car buttons
  addNorth: document.getElementById("add-north")!,
  addSouth: document.getElementById("add-south")!,
  addEast: document.getElementById("add-east")!,
  addWest: document.getElementById("add-west")!,

  // Pedestrian buttons
  pedNS: document.getElementById("ped-ns")!,
  pedEW: document.getElementById("ped-ew")!,

  // Emergency button
  emergencyBtn: document.getElementById("emergency-btn")!,
  clearEmergencyBtn: document.getElementById("clear-emergency-btn")!,

  // Reset button
  resetBtn: document.getElementById("reset-btn")!,

  // Stats
  carsPassed: document.getElementById("cars-passed")!,
  pedestriansCrossed: document.getElementById("pedestrians-crossed")!,

  // Phase timer
  phaseTimer: document.getElementById("phase-timer")!,
  phaseProgress: document.getElementById("phase-progress")!,

  // Status
  statusText: document.getElementById("status-text")!,

  // Pedestrian indicators
  pedNSIndicator: document.getElementById("ped-ns-indicator")!,
  pedEWIndicator: document.getElementById("ped-ew-indicator")!,

  // Emergency overlay
  emergencyOverlay: document.getElementById("emergency-overlay")!,
};

// ============================================================================
// Light Color Updates
// ============================================================================

function updateLight(element: HTMLElement, phase: LightPhase) {
  // Remove all phase classes
  element.classList.remove("green", "yellow", "red");
  // Add current phase
  element.classList.add(phase);

  // Update the light indicators
  const lights = element.querySelectorAll(".light");
  lights.forEach((light) => {
    light.classList.remove("active");
    if (light.classList.contains(phase)) {
      light.classList.add("active");
    }
  });
}

// ============================================================================
// Queue Display
// ============================================================================

function updateQueue(element: HTMLElement, count: number) {
  element.innerHTML = "";
  for (let i = 0; i < Math.min(count, 6); i++) {
    const car = document.createElement("div");
    car.className = "car";
    car.textContent = "🚗";
    element.appendChild(car);
  }
  if (count > 6) {
    const more = document.createElement("div");
    more.className = "more-cars";
    more.textContent = `+${count - 6}`;
    element.appendChild(more);
  }
}

// ============================================================================
// UI Update Loop
// ============================================================================

function updateUI() {
  const state = intersection.getState();

  // Update lights
  updateLight(elements.nsLight, state.nsPhase);
  updateLight(elements.ewLight, state.ewPhase);

  // Update queues
  updateQueue(elements.northQueue, state.queues.north);
  updateQueue(elements.southQueue, state.queues.south);
  updateQueue(elements.eastQueue, state.queues.east);
  updateQueue(elements.westQueue, state.queues.west);

  // Update stats
  elements.carsPassed.textContent = state.stats.carsPassed.toString();
  elements.pedestriansCrossed.textContent = state.stats.pedestriansCrossed.toString();

  // Calculate phase progress using system's derive accessor
  const phaseProgress = intersection.system.read("phaseProgress") as number;
  const phaseElapsed = intersection.system.read("phaseElapsed") as number;

  // Get active phase from state
  const activePhase = state.nsPhase !== "red" ? state.nsPhase : state.ewPhase;

  // Calculate remaining time (approximate based on configuration)
  const greenDuration = 8000;
  const yellowDuration = 2000;
  const duration = activePhase === "yellow" ? yellowDuration : greenDuration;
  const remaining = Math.max(0, Math.ceil((duration - phaseElapsed) / 1000));
  const progress = Math.min(100, phaseProgress * 100);

  elements.phaseTimer.textContent = `${remaining}s`;
  elements.phaseProgress.style.width = `${progress}%`;
  elements.phaseProgress.className = `progress-fill ${activePhase}`;

  // Update pedestrian indicators
  const hasPedRequests = state.pedestrianRequests > 0;

  elements.pedNSIndicator.classList.toggle("waiting", hasPedRequests);
  elements.pedEWIndicator.classList.toggle("waiting", hasPedRequests);

  // Update emergency overlay
  if (state.emergency) {
    elements.emergencyOverlay.classList.add("active");
    elements.emergencyOverlay.textContent = `🚨 EMERGENCY - ${state.emergencyDirection?.toUpperCase()} 🚨`;
    elements.clearEmergencyBtn.style.display = "inline-block";
    elements.emergencyBtn.style.display = "none";
  } else {
    elements.emergencyOverlay.classList.remove("active");
    elements.clearEmergencyBtn.style.display = "none";
    elements.emergencyBtn.style.display = "inline-block";
  }

  // Update status text
  const statusParts = [];
  if (state.nsPhase === "green") statusParts.push("NS: GO");
  else if (state.nsPhase === "yellow") statusParts.push("NS: CAUTION");
  else statusParts.push("NS: STOP");

  if (state.ewPhase === "green") statusParts.push("EW: GO");
  else if (state.ewPhase === "yellow") statusParts.push("EW: CAUTION");
  else statusParts.push("EW: STOP");

  elements.statusText.textContent = statusParts.join(" | ");

  // Auto-remove cars when light is green
  autoProcessCars();
}

// ============================================================================
// Auto-Process Cars (simulate cars passing through)
// ============================================================================

let lastProcessTime = 0;

function autoProcessCars() {
  const now = Date.now();
  if (now - lastProcessTime < 1000) return; // Process every second

  const state = intersection.getState();

  // NS can pass
  if (state.nsPhase === "green" && !state.emergency) {
    if (state.queues.north > 0) {
      intersection.removeCar("north");
    }
    if (state.queues.south > 0) {
      intersection.removeCar("south");
    }
  }

  // EW can pass
  if (state.ewPhase === "green" && !state.emergency) {
    if (state.queues.east > 0) {
      intersection.removeCar("east");
    }
    if (state.queues.west > 0) {
      intersection.removeCar("west");
    }
  }

  lastProcessTime = now;
}

// ============================================================================
// Event Listeners
// ============================================================================

// Add car buttons
elements.addNorth.addEventListener("click", () => intersection.addCar("north"));
elements.addSouth.addEventListener("click", () => intersection.addCar("south"));
elements.addEast.addEventListener("click", () => intersection.addCar("east"));
elements.addWest.addEventListener("click", () => intersection.addCar("west"));

// Pedestrian buttons
elements.pedNS.addEventListener("click", () => intersection.requestPedestrianCrossing("NS"));
elements.pedEW.addEventListener("click", () => intersection.requestPedestrianCrossing("EW"));

// Emergency buttons
let emergencyDirection: Direction = "north";
elements.emergencyBtn.addEventListener("click", () => {
  // Cycle through directions for demo
  const directions: Direction[] = ["north", "south", "east", "west"];
  const idx = directions.indexOf(emergencyDirection);
  emergencyDirection = directions[(idx + 1) % 4];
  intersection.triggerEmergency(emergencyDirection);
});

elements.clearEmergencyBtn.addEventListener("click", () => {
  intersection.clearEmergency();
});

// Reset button
elements.resetBtn.addEventListener("click", () => {
  intersection.reset();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  switch (e.key.toLowerCase()) {
    case "n":
      intersection.addCar("north");
      break;
    case "s":
      intersection.addCar("south");
      break;
    case "e":
      intersection.addCar("east");
      break;
    case "w":
      intersection.addCar("west");
      break;
    case "1":
      intersection.requestPedestrianCrossing("NS");
      break;
    case "2":
      intersection.requestPedestrianCrossing("EW");
      break;
    case " ":
      e.preventDefault();
      if (intersection.getState().emergency) {
        intersection.clearEmergency();
      } else {
        intersection.triggerEmergency("north");
      }
      break;
    case "r":
      intersection.reset();
      break;
  }
});

// ============================================================================
// Start the System
// ============================================================================

// Start the intersection
intersection.start();

// Start the UI update loop
setInterval(updateUI, 50); // 20 FPS

// Initial UI update
updateUI();

console.log("Traffic Intersection started!");
console.log("Keyboard shortcuts: N/S/E/W = add car, 1/2 = pedestrian, SPACE = emergency, R = reset");
console.log("Access the system at window.intersection for debugging");

import { el, bind, mount } from "@directive-run/el";
import { system } from "./module.js";

system.start();

const app = el("div", { style: "font-family: system-ui; max-width: 400px; margin: 40px auto; text-align: center;" }, [
  el("h1", {}, ["Counter"]),
  el("p", { id: "count", style: "font-size: 3rem; font-weight: bold; margin: 20px 0;" }, ["0"]),
  el("p", { id: "doubled", style: "color: #666; margin-bottom: 20px;" }, ["Doubled: 0"]),
  el("div", { style: "display: flex; gap: 8px; justify-content: center;" }, [
    el("button", { onclick: () => system.events.decrement(), style: "padding: 8px 20px; font-size: 1rem;" }, ["-"]),
    el("button", { onclick: () => system.events.reset(), style: "padding: 8px 20px; font-size: 1rem;" }, ["Reset"]),
    el("button", { onclick: () => system.events.increment(), style: "padding: 8px 20px; font-size: 1rem;" }, ["+"]),
  ]),
  el("p", { id: "status", style: "margin-top: 16px; color: #999; font-size: 0.85rem;" }, [""]),
]);

mount(app, document.getElementById("app")!);

// Bind reactive updates
bind(system, document.getElementById("count")!, (s) => {
  return `${s.facts.count}`;
});

bind(system, document.getElementById("doubled")!, (s) => {
  return `Doubled: ${s.derive.doubled}`;
});

bind(system, document.getElementById("status")!, (s) => {
  if (s.facts.count < 0) {
    return "Constraint fired: clamping to zero...";
  }

  return s.facts.count === 0 ? "Try clicking + or -" : "";
});

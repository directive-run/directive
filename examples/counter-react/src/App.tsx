import { useFact, useDerived, useEvents } from "@directive-run/react";
import { system } from "./module";

system.start();

export default function App() {
  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 400, margin: "40px auto", textAlign: "center" }}>
      <h1>Counter (React)</h1>
      <p style={{ fontSize: "3rem", fontWeight: "bold", margin: "20px 0" }}>{count}</p>
      <p style={{ color: "#666", marginBottom: 20 }}>Doubled: {doubled}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button onClick={() => events.decrement()}>-</button>
        <button onClick={() => events.reset()}>Reset</button>
        <button onClick={() => events.increment()}>+</button>
      </div>
      <p style={{ marginTop: 16, color: "#999", fontSize: "0.85rem" }}>
        Try clicking - below zero — the constraint auto-clamps to 0.
      </p>
    </div>
  );
}

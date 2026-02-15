import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, useEvents } from "@directive-run/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const events = useEvents(system);

@customElement("use-events-page")
export class UseEventsPage extends LitElement {
  private _count = new FactController<number>(this, system, "count");

  render() {
    return html`
      <span data-testid="${TestIds.eventsResult}">${this._count.value}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => events.increment()}>
        inc
      </button>
      <button data-testid="${TestIds.btnDecrement}" @click=${() => events.decrement()}>
        dec
      </button>
    `;
  }
}

import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, InspectController } from "directive/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

@customElement("use-inspect-page")
export class UseInspectPage extends LitElement {
  private _inspect = new InspectController(this, system);
  private _status = new FactController<string>(this, system, "status");

  render() {
    return html`
      <span data-testid="${TestIds.inspectSettled}">${String(this._inspect.value.isSettled)}</span>
      <span data-testid="${TestIds.inspectWorking}">${String(this._inspect.value.isWorking)}</span>
      <span data-testid="${TestIds.factSingle}">${this._status.value}</span>
      <button data-testid="${TestIds.btnTriggerLoad}" @click=${() => system.events.triggerLoad()}>
        trigger load
      </button>
      <button data-testid="${TestIds.btnReset}" @click=${() => system.events.reset()}>
        reset
      </button>
    `;
  }
}

import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, ConstraintStatusController } from "@directive-run/lit";
import type { ConstraintInfo } from "@directive-run/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

@customElement("use-constraint-status-page")
export class UseConstraintStatusPage extends LitElement {
  private _constraints = new ConstraintStatusController(this, system);
  private _status = new FactController<string>(this, system, "status");

  render() {
    const constraints = this._constraints.value as ConstraintInfo[];
    const activeCount = constraints.filter((c) => c.active).length;

    return html`
      <span data-testid="${TestIds.constraintList}">${constraints.length}</span>
      <span data-testid="${TestIds.constraintActive}">${activeCount}</span>
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

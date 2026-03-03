import {
  FactController,
  RequirementStatusController,
} from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { statusPlugin, system } from "../system";

@customElement("use-requirement-status-page")
export class UseRequirementStatusPage extends LitElement {
  private _reqStatus = new RequirementStatusController(
    this,
    statusPlugin,
    "LOAD_DATA",
  );
  private _status = new FactController<string>(this, system, "status");

  render() {
    return html`
      <span data-testid="${TestIds.reqStatusPending}">${this._reqStatus.value.pending}</span>
      <span data-testid="${TestIds.reqStatusLoading}">${String(this._reqStatus.value.isLoading)}</span>
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

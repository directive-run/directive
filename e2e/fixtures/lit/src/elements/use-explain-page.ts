import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, ExplainController } from "directive/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

@customElement("use-explain-page")
export class UseExplainPage extends LitElement {
  private _status = new FactController<string>(this, system, "status");
  private _explanation = new ExplainController(this, system, "LOAD_DATA:{}");

  render() {
    return html`
      <span data-testid="${TestIds.explainResult}">${this._explanation.value ?? "null"}</span>
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

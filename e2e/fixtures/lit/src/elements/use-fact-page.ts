import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController } from "directive/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

@customElement("use-fact-page")
export class UseFactPage extends LitElement {
  private _count = new FactController<number>(this, system, "count");
  private _countMulti = new FactController<number>(this, system, "count");
  private _nameMulti = new FactController<string>(this, system, "name");

  render() {
    return html`
      <span data-testid="${TestIds.factSingle}">${this._count.value}</span>
      <span data-testid="${TestIds.factMulti}">${this._countMulti.value}</span>
      <span data-testid="${TestIds.factMultiName}">${this._nameMulti.value}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
      <button data-testid="${TestIds.btnSetName}" @click=${() => system.events.setName({ name: "world" })}>
        set name
      </button>
    `;
  }
}

import { DirectiveSelectorController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

@customElement("use-selector-page")
export class UseSelectorPage extends LitElement {
  private _tripled = new DirectiveSelectorController<number>(
    this,
    system,
    (facts) => (facts.count as number) * 3,
  );

  render() {
    return html`
      <span data-testid="${TestIds.selectorResult}">${this._tripled.value}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
    `;
  }
}

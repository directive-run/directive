import { DerivedController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

@customElement("use-derived-page")
export class UseDerivedPage extends LitElement {
  private _doubled = new DerivedController<number>(this, system, "doubled");
  private _isPositive = new DerivedController<boolean>(
    this,
    system,
    "isPositive",
  );
  private _multi = new DerivedController<{
    doubled: number;
    isPositive: boolean;
  }>(this, system, ["doubled", "isPositive"]);

  render() {
    return html`
      <span data-testid="${TestIds.derivedSingle}">${this._doubled.value}</span>
      <span data-testid="${TestIds.derivedBool}">${String(this._isPositive.value)}</span>
      <span data-testid="${TestIds.derivedMulti}">${JSON.stringify(this._multi.value)}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
    `;
  }
}

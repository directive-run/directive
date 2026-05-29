import { DirectiveSelectorController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

@customElement("use-selector-default-page")
export class UseSelectorDefaultPage extends LitElement {
  // System is already started, so the init value wins over any pre-start default.
  private _name = new DirectiveSelectorController<string>(
    this,
    system,
    (facts) => (facts.name as string) ?? "pre-start-default",
  );

  private _count = new DirectiveSelectorController<number>(
    this,
    system,
    (facts) => (facts.count as number) ?? -1,
  );

  render() {
    return html`
      <span data-testid="${TestIds.selectorRefDefault}">${this._name.value}</span>
      <span data-testid="${TestIds.selectorRefLive}">${this._count.value}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
    `;
  }
}

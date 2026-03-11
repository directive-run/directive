import { ModuleController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { testModule } from "../../../../shared/test-module";

@customElement("use-directive-page")
export class UseDirectivePage extends LitElement {
  private _module = new ModuleController(this, testModule, {
    history: { maxSnapshots: 50 },
  });

  render() {
    let sys: unknown;
    let factCount: unknown = "";
    let derivedDoubled: unknown = "";
    let events: { increment?: () => void } | undefined;

    try {
      sys = this._module.system;
      factCount = this._module.facts.count;
      derivedDoubled = this._module.derived.doubled;
      events = this._module.events;
    } catch {
      // system not yet available before hostConnected
    }

    return html`
      <span data-testid="${TestIds.directiveFact}">${factCount}</span>
      <span data-testid="${TestIds.directiveDerived}">${derivedDoubled}</span>
      <span data-testid="${TestIds.directiveSystem}">${sys ? "valid" : "null"}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => events?.increment?.()}>
        inc
      </button>
    `;
  }
}

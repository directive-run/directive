import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, TimeTravelController } from "directive/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

@customElement("use-time-travel-page")
export class UseTimeTravelPage extends LitElement {
  private _count = new FactController<number>(this, system, "count");
  private _tt = new TimeTravelController(this, system);

  render() {
    const tt = this._tt.value;
    return html`
      <span data-testid="${TestIds.factSingle}">${this._count.value}</span>
      <span data-testid="${TestIds.timeTravelEnabled}">${String(tt !== null)}</span>
      <span data-testid="${TestIds.timeTravelCanUndo}">${String(tt?.canUndo ?? false)}</span>
      <span data-testid="${TestIds.timeTravelCanRedo}">${String(tt?.canRedo ?? false)}</span>
      <span data-testid="${TestIds.timeTravelIndex}">${tt?.currentIndex ?? -1}</span>
      <span data-testid="${TestIds.timeTravelTotal}">${tt?.totalSnapshots ?? 0}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
      <button data-testid="${TestIds.btnUndo}" @click=${() => tt?.undo()}>
        undo
      </button>
      <button data-testid="${TestIds.btnRedo}" @click=${() => tt?.redo()}>
        redo
      </button>
    `;
  }
}

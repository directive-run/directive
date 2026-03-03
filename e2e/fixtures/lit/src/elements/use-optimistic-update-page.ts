import { FactController, OptimisticUpdateController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { statusPlugin, system } from "../system";

@customElement("use-optimistic-update-page")
export class UseOptimisticUpdatePage extends LitElement {
  private _count = new FactController<number>(this, system, "count");
  private _optimistic = new OptimisticUpdateController(
    this,
    system,
    statusPlugin,
    "LOAD_DATA",
  );

  render() {
    return html`
      <span data-testid="${TestIds.optimisticValue}">${this._count.value}</span>
      <span data-testid="${TestIds.optimisticPending}">${String(this._optimistic.isPending)}</span>
      <span data-testid="${TestIds.optimisticError}">${this._optimistic.error?.message ?? "null"}</span>
      <button
        data-testid="${TestIds.btnMutate}"
        @click=${() =>
          this._optimistic.mutate(() => {
            system.facts.count = system.facts.count + 10;
            system.facts.status = "loading";
          })}
      >
        mutate
      </button>
      <button data-testid="${TestIds.btnRollback}" @click=${() => this._optimistic.rollback()}>
        rollback
      </button>
      <button data-testid="${TestIds.btnReset}" @click=${() => system.events.reset()}>
        reset
      </button>
    `;
  }
}

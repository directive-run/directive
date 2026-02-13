import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, useDispatch } from "directive/lit";
import { system } from "../system";
import { TestIds } from "../../../../shared/test-ids";

const dispatch = useDispatch(system);

@customElement("use-dispatch-page")
export class UseDispatchPage extends LitElement {
  private _count = new FactController<number>(this, system, "count");

  render() {
    return html`
      <span data-testid="${TestIds.dispatchResult}">${this._count.value}</span>
      <button
        data-testid="${TestIds.btnDispatchIncrement}"
        @click=${() => dispatch({ type: "increment" })}
      >
        dispatch inc
      </button>
    `;
  }
}

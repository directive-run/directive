import { FactController, HistoryController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

@customElement("use-history-page")
export class UseHistoryPage extends LitElement {
  private _count = new FactController<number>(this, system, "count");
  private _history = new HistoryController(this, system);

  render() {
    const history = this._history.value;
    return html`
      <span data-testid="${TestIds.factSingle}">${this._count.value}</span>
      <span data-testid="${TestIds.historyEnabled}">${String(history !== null)}</span>
      <span data-testid="${TestIds.historyCanGoBack}">${String(history?.canGoBack ?? false)}</span>
      <span data-testid="${TestIds.historyCanGoForward}">${String(history?.canGoForward ?? false)}</span>
      <span data-testid="${TestIds.historyIndex}">${history?.currentIndex ?? -1}</span>
      <span data-testid="${TestIds.historyTotal}">${history?.totalSnapshots ?? 0}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
      <button data-testid="${TestIds.btnGoBack}" @click=${() => history?.goBack()}>
        goBack
      </button>
      <button data-testid="${TestIds.btnGoForward}" @click=${() => history?.goForward()}>
        goForward
      </button>
    `;
  }
}

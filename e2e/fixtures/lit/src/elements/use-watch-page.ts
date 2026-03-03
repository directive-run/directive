import { WatchController } from "@directive-run/lit";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

@customElement("use-watch-page")
export class UseWatchPage extends LitElement {
  @state() private _prev = "none";
  @state() private _next = "none";
  @state() private _watchCount = 0;

  private _watcher = new WatchController<number>(
    this,
    system,
    "count",
    (newVal, prevVal) => {
      this._prev = String(prevVal ?? "none");
      this._next = String(newVal);
      this._watchCount += 1;
    },
  );

  render() {
    return html`
      <span data-testid="${TestIds.watchPrev}">${this._prev}</span>
      <span data-testid="${TestIds.watchNew}">${this._next}</span>
      <span data-testid="${TestIds.watchCount}">${this._watchCount}</span>
      <button data-testid="${TestIds.btnIncrement}" @click=${() => system.events.increment()}>
        inc
      </button>
    `;
  }
}

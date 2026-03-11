import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { html as staticHtml, unsafeStatic } from "lit/static-html.js";

const routes: Record<string, string> = {
  useFact: "use-fact-page",
  useDerived: "use-derived-page",
  useSelector: "use-selector-page",
  useDispatch: "use-dispatch-page",
  useWatch: "use-watch-page",
  useInspect: "use-inspect-page",
  useEvents: "use-events-page",
  useExplain: "use-explain-page",
  useConstraintStatus: "use-constraint-status-page",
  useOptimisticUpdate: "use-optimistic-update-page",
  useRequirementStatus: "use-requirement-status-page",
  useHistory: "use-history-page",
  useDirective: "use-directive-page",
};

@customElement("app-root")
export class AppRoot extends LitElement {
  @state() private _route = "";

  connectedCallback() {
    super.connectedCallback();
    this._route = window.location.hash.slice(2) || "";
    window.addEventListener("hashchange", this._onHash);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this._onHash);
  }

  private _onHash = () => {
    this._route = window.location.hash.slice(2) || "";
  };

  render() {
    const tag = routes[this._route];
    if (!tag) {
      return html`<div>Select a route: ${Object.keys(routes).join(", ")}</div>`;
    }
    return staticHtml`<${unsafeStatic(tag)}></${unsafeStatic(tag)}>`;
  }
}

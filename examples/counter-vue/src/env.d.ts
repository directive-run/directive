// Single-file component shim. tsc cannot read .vue files; vue-tsc/Volar
// type-check them in the editor.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

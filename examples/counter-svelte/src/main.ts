import { mount } from "svelte";
import App from "./App.svelte";

// Svelte 5 mount API. The Svelte-4 `new App({ target })` constructor
// shape was removed; `mount()` is the replacement.
const app = mount(App, { target: document.getElementById("app")! });

export default app;

/**
 * htm tagged template binding for @directive-run/el.
 *
 * Usage:
 *   import { html } from "@directive-run/el/htm";
 *
 *   const app = html`
 *     <div class="card">
 *       <h2>Title</h2>
 *       <p>Count: ${count}</p>
 *     </div>
 *   `;
 *
 * Requires `htm` as a peer dependency:
 *   npm install htm
 */

import htm from "htm";
import { el } from "./el.js";

export const html = htm.bind(el);

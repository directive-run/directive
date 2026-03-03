// @ts-nocheck
/**
 * Contact Form System Singleton
 *
 * Creates and configures the Directive system for the contact form.
 * Reads NEXT_PUBLIC_FORMSPREE_ID from env for the submission endpoint.
 */
import { createSystem } from "@directive-run/core";
import { contactForm } from "./module";

// ---------------------------------------------------------------------------
// Formspree endpoint
// ---------------------------------------------------------------------------

export const FORMSPREE_ENDPOINT =
  typeof process !== "undefined"
    ? (process.env?.NEXT_PUBLIC_FORMSPREE_ID ?? "")
    : "";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ReturnType<
  typeof createSystem<(typeof contactForm)["schema"]>
> | null = null;

export function getContactFormSystem() {
  if (instance) {
    return instance;
  }

  instance = createSystem({ module: contactForm });
  instance.start();

  return instance;
}

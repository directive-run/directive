/**
 * Schema Pattern 4: Mixed Patterns
 *
 * Demonstrates mixing all three patterns in the same schema:
 * - t.*() builders for simple types with basic validation
 * - Zod for complex validation
 * - type assertion for type-only definitions
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { z } from "zod";

// ============================================================================
// Shared Zod Schemas
// ============================================================================

// Email can be empty string or valid email
const EmailSchema = z.union([z.literal(""), z.string().email()]);
const UrlSchema = z.string().url();
const PhoneSchema = z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number");

const AddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/),
});
type Address = z.infer<typeof AddressSchema>;

// ============================================================================
// Module with Mixed Schema Patterns
// ============================================================================

const userProfileModule = createModule("user-profile", {
  schema: {
    facts: {
      // Simple types with t.*() - lightweight, no deps
      userId: t.number(),
      isActive: t.boolean(),
      role: t.string<"admin" | "user" | "guest">(),

      // Complex validation with Zod - rich validation
      email: EmailSchema,
      phone: PhoneSchema.nullable(),
      website: UrlSchema.optional(),
      address: AddressSchema.nullable(),

      // Arrays with t.*()
      tags: t.array<string>(),
    },

    // Derivations - use type assertion for simplicity (type-only)
    derivations: {} as {
      isAdmin: boolean;
      hasContact: boolean;
      displayRole: string;
      profileCompleteness: number;
    },

    // Events - mix t.*() and Zod
    events: {
      // Simple events with t.*()
      activate: {},
      deactivate: {},
      setRole: { role: t.string<"admin" | "user" | "guest">() },

      // Complex payloads with Zod
      updateEmail: { email: EmailSchema },
      updateAddress: { address: AddressSchema },
      addTag: { tag: z.string().min(1).max(20) },
    },

    // Requirements - type assertion (type-only)
    requirements: {} as {
      VALIDATE_EMAIL: { email: string };
      GEOCODE_ADDRESS: { address: Address };
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.isActive = false;
    facts.role = "guest";
    facts.email = "";
    facts.phone = null;
    facts.website = undefined;
    facts.address = null;
    facts.tags = [];
  },

  derive: {
    isAdmin: (facts) => facts.role === "admin",
    hasContact: (facts) => facts.email !== "" || facts.phone !== null,
    displayRole: (facts) => {
      switch (facts.role) {
        case "admin": return "Administrator";
        case "user": return "User";
        case "guest": return "Guest";
      }
    },
    profileCompleteness: (facts) => {
      let score = 0;
      if (facts.email) score += 25;
      if (facts.phone) score += 25;
      if (facts.address) score += 25;
      if (facts.tags.length > 0) score += 25;
      return score;
    },
  },

  events: {
    activate: (facts) => {
      facts.isActive = true;
    },
    deactivate: (facts) => {
      facts.isActive = false;
    },
    setRole: (facts, { role }) => {
      facts.role = role;
    },
    updateEmail: (facts, { email }) => {
      facts.email = email;
    },
    updateAddress: (facts, { address }) => {
      facts.address = address;
    },
    addTag: (facts, { tag }) => {
      if (!facts.tags.includes(tag)) {
        facts.tags = [...facts.tags, tag];
      }
    },
  },

  constraints: {
    validateNewEmail: {
      when: (facts) => facts.email !== "" && !facts.email.includes("@verified"),
      require: (facts) => ({
        type: "VALIDATE_EMAIL",
        email: facts.email,
      }),
    },
    geocodeAddress: {
      when: (facts) => facts.address !== null,
      require: (facts) => ({
        type: "GEOCODE_ADDRESS",
        address: facts.address!,
      }),
    },
  },

  resolvers: {
    validateEmail: {
      requirement: "VALIDATE_EMAIL",
      resolve: async (req, ctx) => {
        console.log(`[Resolver] Validating email: ${req.email}`);
        await new Promise((r) => setTimeout(r, 50));
        // Mark as verified
        ctx.facts.email = `${req.email}@verified`;
      },
    },
    geocodeAddress: {
      requirement: "GEOCODE_ADDRESS",
      resolve: async (req, ctx) => {
        console.log(`[Resolver] Geocoding address: ${req.address.city}, ${req.address.state}`);
        await new Promise((r) => setTimeout(r, 50));
        // In real app, would add lat/lng to address
      },
    },
  },
});

// ============================================================================
// Test the Module
// ============================================================================

async function main() {
  console.log("=== Pattern 4: Mixed Schema Patterns ===\n");

  const system = createSystem({ module: userProfileModule });
  system.start();

  // Initial state
  console.log("Initial state:");
  console.log("  userId:", system.facts.userId);
  console.log("  role:", system.facts.role);
  console.log("  isAdmin:", system.derive.isAdmin);
  console.log("  profileCompleteness:", system.derive.profileCompleteness + "%");

  // Use t.*() typed event
  console.log("\n--- Using t.*() event (setRole) ---");
  system.dispatch({ type: "setRole", role: "admin" });
  console.log("  role:", system.facts.role);
  console.log("  displayRole:", system.derive.displayRole);
  console.log("  isAdmin:", system.derive.isAdmin);

  // Use Zod validated event
  console.log("\n--- Using Zod event (updateEmail) ---");
  system.dispatch({ type: "updateEmail", email: "user@example.com" });
  await system.settle();
  console.log("  email:", system.facts.email);
  console.log("  hasContact:", system.derive.hasContact);

  // Use Zod validated event with complex type
  console.log("\n--- Using Zod event (updateAddress) ---");
  system.dispatch({
    type: "updateAddress",
    address: {
      street: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
  });
  await system.settle();
  console.log("  address:", system.facts.address);
  console.log("  profileCompleteness:", system.derive.profileCompleteness + "%");

  // Add tags
  console.log("\n--- Using Zod event (addTag) ---");
  system.dispatch({ type: "addTag", tag: "typescript" });
  system.dispatch({ type: "addTag", tag: "directive" });
  console.log("  tags:", system.facts.tags);
  console.log("  profileCompleteness:", system.derive.profileCompleteness + "%");

  // Activate
  console.log("\n--- Using simple event (activate) ---");
  system.dispatch({ type: "activate" });
  console.log("  isActive:", system.facts.isActive);

  system.stop();
  console.log("\n=== Pattern 4 Complete ===");
}

main().catch(console.error);

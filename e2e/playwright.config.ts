import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter e2e-react exec vite preview --port 4001 --strictPort",
      port: 4001,
      reuseExistingServer: !CI,
      cwd: "..",
    },
    {
      command:
        "pnpm --filter e2e-vue exec vite preview --port 4002 --strictPort",
      port: 4002,
      reuseExistingServer: !CI,
      cwd: "..",
    },
    {
      command:
        "pnpm --filter e2e-svelte exec vite preview --port 4003 --strictPort",
      port: 4003,
      reuseExistingServer: !CI,
      cwd: "..",
    },
    {
      command:
        "pnpm --filter e2e-solid exec vite preview --port 4004 --strictPort",
      port: 4004,
      reuseExistingServer: !CI,
      cwd: "..",
    },
    {
      command:
        "pnpm --filter e2e-lit exec vite preview --port 4005 --strictPort",
      port: 4005,
      reuseExistingServer: !CI,
      cwd: "..",
    },
  ],
});

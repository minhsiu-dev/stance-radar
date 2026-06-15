import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // All specs share one backend DB; parallel workers would pollute each other's
  // state (e.g. after one spec adds a channel, golden-path's "brand-new add"
  // branch wouldn't fire). Pin to a single worker and run serially.
  workers: 1,
  use: {
    // Default to localhost for the host-run flow; the containerized test-runner
    // (Dockerfile.testrunner) overrides this to the frontend service hostname.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    launchOptions,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions,
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // 所有 spec 共用同一個後端 DB,平行 worker 會互相污染狀態(例如某 spec 新增頻道
  // 後,golden-path 的「全新加入」分支就不會觸發)。固定單 worker 串行執行。
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

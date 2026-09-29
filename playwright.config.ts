import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * End-to-end tests run against a production build (the service worker only runs there),
 * on a 360×640 phone screen: the target low-end Android size (CLAUDE.md).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "android-360",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    // CI builds in its own step; locally build first so the tests see what users get.
    command: process.env.CI
      ? `npm run start -- -p ${PORT}`
      : `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});

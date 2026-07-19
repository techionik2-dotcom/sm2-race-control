const { defineConfig } = require("@playwright/test");

const port = process.env.PLAYWRIGHT_PORT || process.env.PORT || "3000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const startCommand =
  process.env.PLAYWRIGHT_START_COMMAND ||
  `npm run dev -- --hostname 127.0.0.1 --port ${port}`;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: startCommand,
    cwd: __dirname,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

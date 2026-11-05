// Browser tests of the chat: real pages, a real sign-in, and the API mocked - free, the same every
// time, and nothing is written to the database. Needs the site running (npm run dev in web/, port 3000)
// and a TEST account in web/.env.local (gitignored): E2E_EMAIL, E2E_PASSWORD.
//   cd e2e && npm test
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", screenshot: "only-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.js/ },
    { name: "chat", dependencies: ["setup"], testIgnore: /auth\.setup\.js/, use: { storageState: ".auth/user.json" } },
  ],
});

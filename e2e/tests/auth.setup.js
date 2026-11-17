// Signs in once with the test account and keeps the session for the tests
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(__dirname, "..", "..", "web", ".env.local");
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

test("sign in", async ({ page }) => {
  const email = fromEnvFile("E2E_EMAIL");
  const password = fromEnvFile("E2E_PASSWORD");
  if (!email || !password) throw new Error("Add E2E_EMAIL and E2E_PASSWORD of a TEST account to web/.env.local");
  await page.goto("/auth/sign-in?next=/chat");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/chat/, { timeout: 20_000 });
  await page.context().storageState({ path: path.join(__dirname, "..", ".auth", "user.json") });
});

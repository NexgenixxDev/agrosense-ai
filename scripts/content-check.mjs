import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173");
await page
  .getByLabel("Choose a development account")
  .selectOption("admin-demo");
await page.getByRole("button", { name: "Open workspace" }).click();
await page
  .getByRole("button", { name: "Guidance library", exact: true })
  .click();
await page.getByRole("button", { name: "Create guidance draft" }).click();
await page.getByLabel("Condition identifier").fill("interface_review_test");
await page
  .getByLabel("Title", { exact: true })
  .fill("Development review workflow test");
await page
  .getByLabel("Guidance", { exact: true })
  .fill(
    "Sample content to verify reviewer approval. Not approved agronomic advice.",
  );
await page
  .getByLabel("Source URL")
  .fill("https://example.org/development-only");
await page.getByRole("button", { name: "Save draft", exact: true }).click();
await page
  .getByRole("heading", { name: "Development review workflow test" })
  .waitFor();
assert.equal(
  await page.getByRole("button", { name: "Publish reviewed version" }).count(),
  0,
);
await page.getByRole("button", { name: "Sign out" }).click();
await page
  .getByLabel("Choose a development account")
  .selectOption("reviewer-demo");
await page.getByRole("button", { name: "Open workspace" }).click();
await page
  .getByRole("button", { name: "Guidance library", exact: true })
  .click();
const card = page
  .locator("article")
  .filter({
    has: page.getByRole("heading", {
      name: "Development review workflow test",
    }),
  })
  .first();
await card.getByRole("button", { name: "Publish reviewed version" }).click();
await card.getByText("published · v1").waitFor();
console.log(
  "Administrator drafting and separate reviewer publication passed in browser.",
);
await browser.close();

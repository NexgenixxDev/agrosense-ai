import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1060 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173");
await page.getByRole("button", { name: "Open workspace" }).click();
await page.getByRole("heading", { name: "Good to see you, Daniel." }).waitFor();
await page.screenshot({
  path: "docs/screenshots/advisor-overview.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Open", exact: true }).first().click();
await page.getByRole("heading", { name: "Farmer observations" }).waitFor();
await page
  .getByLabel("Practical next steps")
  .fill(
    "Browser integration test: please take a whole-plant photograph. Development example only.",
  );
await page.getByRole("button", { name: "Send advisor response" }).click();
await page
  .getByText(
    "Browser integration test: please take a whole-plant photograph. Development example only.",
    { exact: true },
  )
  .waitFor();
await page.screenshot({
  path: "docs/screenshots/advisor-case.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Close case", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "docs/screenshots/portal-mobile.png",
  fullPage: true,
});
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  ),
  false,
  "Page should not overflow horizontally",
);
assert.deepEqual(errors, []);
console.log(
  "Browser sign-in, overview, case detail, advisor response and responsive layout passed.",
);
await browser.close();

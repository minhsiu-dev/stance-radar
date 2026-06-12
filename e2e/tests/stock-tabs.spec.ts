import { expect, test } from "@playwright/test";

test("stock page renders Tabs and chart stays mounted", async ({ page }) => {
  await page.goto("/en/stocks/AAPL");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await page.getByRole("tab", { name: "Mentions" }).click();
  await page.waitForTimeout(500);
  await expect(page.locator("canvas").first()).toBeVisible();
});

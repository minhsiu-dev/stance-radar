import { expect, test } from "@playwright/test";

test("Financials tab toggles period and renders five series", async ({ page }) => {
  await page.goto("/en/stocks/AAPL");
  await page.getByRole("tab", { name: "Financials" }).click();
  await page.waitForTimeout(500);

  for (const label of [
    "Total revenue",
    "Gross profit",
    "Operating income",
    "Pretax income",
    "Net income",
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Annual" }).click();
  await expect(page.getByText("Total revenue", { exact: true }).first()).toBeVisible();
});

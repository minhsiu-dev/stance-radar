import { expect, test } from "@playwright/test";

test("portfolio: add transaction → holdings row → homepage card & filter", async ({ page }) => {
  await page.goto("/en/portfolio");

  await page.getByPlaceholder(/ticker, e\.g\. AAPL/i).fill("AAPL");
  await page.getByLabel("Shares", { exact: true }).fill("10");
  await page.getByLabel("Price", { exact: true }).fill("150");
  await page.getByLabel("Date", { exact: true }).fill("2026-01-15");
  await page.getByRole("button", { name: /^add$/i }).click();

  // holdings table shows AAPL, total market value updates
  await expect(
    page.getByRole("link", { name: "AAPL" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Market value")).toBeVisible();

  // home page: portfolio card shows "My portfolio" (when holdings exist), VOO benchmark card is present too
  await page.goto("/en");
  await expect(page.getByText("My portfolio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("VOO").first()).toBeVisible();
  // "No holdings yet" hint should not be visible when we have holdings
  await expect(page.getByText("No holdings yet")).not.toBeVisible();

  // clean up this transaction so it doesn't affect other specs' reruns
  await page.goto("/en/portfolio");
  await page.getByRole("button", { name: /^delete$/i }).first().click();
  await expect(page.getByText("No transactions yet")).toBeVisible();
});

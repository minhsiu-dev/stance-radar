import { expect, test } from "@playwright/test";

test("portfolio: add transaction → holdings row → homepage card & filter", async ({ page }) => {
  await page.goto("/en/portfolio");

  await page.getByPlaceholder(/ticker, e\.g\. AAPL/i).fill("AAPL");
  await page.getByLabel("Shares", { exact: true }).fill("10");
  await page.getByLabel("Price", { exact: true }).fill("150");
  await page.getByLabel("Date", { exact: true }).fill("2026-01-15");
  await page.getByRole("button", { name: /^add$/i }).click();

  // 持股明細出現 AAPL,總市值更新
  await expect(
    page.getByRole("link", { name: "AAPL" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Market value")).toBeVisible();

  // 首頁:組合卡顯示 My portfolio(有持股時),VOO benchmark card 也在
  await page.goto("/en");
  await expect(page.getByText("My portfolio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("VOO").first()).toBeVisible();
  // "No holdings yet" hint should not be visible when we have holdings
  await expect(page.getByText("No holdings yet")).not.toBeVisible();

  // 清掉這筆,避免影響其他 spec 的重跑
  await page.goto("/en/portfolio");
  await page.getByRole("button", { name: /^delete$/i }).first().click();
  await expect(page.getByText("No transactions yet")).toBeVisible();
});

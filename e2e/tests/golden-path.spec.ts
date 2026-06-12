import { expect, test } from "@playwright/test";

test("golden path: add channel → review → analyze → dashboard → stock → channel page", async ({ page }) => {
  // 1. Channel management: paste two fake channel IDs
  await page.goto("/en/channels");
  await page
    .getByPlaceholder(/channel ID/i)
    .fill("UC_fake_alpha UC_fake_beta");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText(/added|already exists/i)).toBeVisible();
  // 「Added …」= 全新狀態,discover 一定會產出待挑選影片;
  // 「Already exists …」= 重複執行,影片早已分析完 → 挑選頁是空的
  const freshAdd = await page.getByText(/^added /i).isVisible();

  // 2. Review page: confirm the default all-checked selection
  await page.goto("/en/review");
  const confirmButton = page.getByRole("button", { name: /analyze selected/i });
  if (freshAdd) {
    await expect(async () => {
      await page.reload();
      await expect(confirmButton).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }
  if (await confirmButton.isVisible()) {
    await confirmButton.click();
    await expect(page).toHaveURL(/\/en\/?$/, { timeout: 10_000 });
  }

  // 3. Dashboard: wait for analyze job, expect videos and stance chips
  await page.goto("/en");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("AAPL 財報解讀")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/no transcript/i).first()).toBeVisible(); // beta_vid_1

  // 4. Click stance chip → stock page
  await page.getByRole("link", { name: "AAPL · Buy" }).first().click();
  await expect(page).toHaveURL(/\/en\/stocks\/AAPL/);
  await expect(page.getByText("Apple Inc.")).toBeVisible();
  await page.getByRole("tab", { name: "Mentions" }).click();
  await expect(page.getByRole("cell", { name: "0:12" })).toBeVisible();
  await expect(page.getByText("蘋果這季財報很強,我會買")).toBeVisible();

  // 5. Channel detail page: stats + video list with status badges
  await page.goto("/en/channels");
  await page.getByRole("link", { name: "頻道 Alpha" }).click();
  await expect(page).toHaveURL(/\/en\/channels\/UC_fake_alpha/);
  await expect(page.getByText("Most mentioned stocks")).toBeVisible();
  await expect(page.getByText("AAPL 財報解讀")).toBeVisible();
  await expect(page.getByText(/^analyzed$/i).first()).toBeVisible();
});

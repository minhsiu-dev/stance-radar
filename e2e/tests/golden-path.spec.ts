import { expect, test } from "@playwright/test";

test("golden path: 貼頻道 → 自動分析 → dashboard → 股票頁", async ({ page }) => {
  // 1. 頻道管理:貼兩個 fake channel ID
  await page.goto("/channels");
  await page
    .getByPlaceholder(/channel ID/)
    .fill("UC_fake_alpha UC_fake_beta");
  await page.getByRole("button", { name: "新增" }).click();
  await expect(page.getByText(/已加入/)).toBeVisible();

  // 2. Dashboard:等背景 job 完成,影片與 stance chips 出現
  await page.goto("/");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("AAPL 財報解讀")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("無字幕")).toBeVisible(); // beta_vid_1

  // 3. 點 stance chip 進股票頁
  await page.getByRole("link", { name: "AAPL · Buy" }).first().click();
  await expect(page).toHaveURL(/\/stocks\/AAPL/);

  // 4. 股票頁:報價標頭、提及表格(秒數、原句、立場)
  await expect(page.getByText("Apple Inc.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "0:12" })).toBeVisible();
  await expect(page.getByText("蘋果這季財報很強,我會買")).toBeVisible();
});

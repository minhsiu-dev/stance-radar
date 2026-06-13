import { expect, test } from "@playwright/test";

test("golden path: add channel → review → analyze → dashboard → stock → channel page", async ({ page }) => {
  // 1. Channel management: paste two fake channel IDs
  await page.goto("/en/channels");
  await page
    .getByPlaceholder(/channel ID/i)
    .fill("UC_fake_alpha UC_fake_beta");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText(/added|already exists/i)).toBeVisible();

  // 2. Review page: confirm the default all-checked selection.
  // discover 是 add 之後的背景工作,挑選頁可能還沒灌入影片;不要依賴「Added vs
  // Already exists」這條會閃現/被重繪覆蓋的訊息判斷狀態(會 race),改成直接輪詢
  // 挑選頁:出現 confirm 按鈕就按、若是空的(代表早已分析過)就跳過。
  await page.goto("/en/review");
  const confirmButton = page.getByRole("button", { name: /analyze selected/i });
  const emptyState = page.getByText(/no videos awaiting review/i);
  await expect(async () => {
    await page.reload();
    await expect(confirmButton.or(emptyState).first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
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
  await expect(page.getByText("Most mentioned")).toBeVisible();
  // Videos tab is the default tab; its list shows the analyzed video + badge
  await expect(page.getByRole("tab", { name: /videos/i })).toBeVisible();
  await expect(page.getByText("AAPL 財報解讀")).toBeVisible();
  await expect(page.getByText(/^analyzed$/i).first()).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("golden path: add channel → analyze → dashboard → stock page", async ({ page }) => {
  // 1. Channel management: paste two fake channel IDs
  await page.goto("/en/channels");
  await page
    .getByPlaceholder(/channel ID/i)
    .fill("UC_fake_alpha UC_fake_beta");
  await page.getByRole("button", { name: /^add$/i }).click();
  // Message is "Added {names}" on first add, "Already exists: {names}" on repeat runs
  await expect(page.getByText(/added|already exists/i)).toBeVisible();

  // 2. Dashboard: wait for background job, expect videos and stance chips
  await page.goto("/en");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("AAPL 財報解讀")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/no transcript/i).first()).toBeVisible(); // beta_vid_1

  // 3. Click stance chip → stock page
  await page.getByRole("link", { name: "AAPL · Buy" }).first().click();
  await expect(page).toHaveURL(/\/en\/stocks\/AAPL/);

  // 4. Stock page: price header, mentions table (timestamp, quote, stance)
  await expect(page.getByText("Apple Inc.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "0:12" })).toBeVisible();
  await expect(page.getByText("蘋果這季財報很強,我會買")).toBeVisible();
});

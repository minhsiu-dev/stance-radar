import { expect, test } from "@playwright/test";

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin";

test("golden path: add channel → import → analyze → dashboard → stock → channel page", async ({ page }) => {
  // 0. Writes (adding channels, picking videos) are admin-gated. page.request shares
  //    the browser context's cookie jar, so the sr_admin cookie applies to the page too.
  const unlock = await page.request.post("/api/admin/unlock", {
    data: { password: ADMIN_PASSWORD },
  });
  expect(unlock.ok()).toBeTruthy();

  // 1. Channel management: paste two fake channel IDs
  await page.goto("/en/channels");
  //    The add form lives in a dialog that only renders for an unlocked admin. It closes
  //    on success; if both channels already exist it stays open and says so.
  await page.getByRole("button", { name: "Add channel" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/channel ID/i).fill("UC_fake_alpha UC_fake_beta");
  await dialog.getByRole("button", { name: /^add$/i }).click();
  await expect(async () => {
    const closed = (await dialog.count()) === 0;
    const exists = (await dialog.getByText(/already exists/i).count()) > 0;
    expect(closed || exists).toBeTruthy();
  }).toPass({ timeout: 15_000 });

  // 2. The old selection page now lands on the import page
  await page.goto("/en/review");
  await expect(page).toHaveURL(/\/en\/pipeline/);

  // 3. Inbox: discover runs in the background after the add and commits channel by
  //    channel, so the submit button can show up with only alpha's videos. Wait for the
  //    discover job itself to finish before looking at the page.
  await expect(async () => {
    const res = await page.request.get("/api/jobs/current");
    expect(res.status()).toBe(200);
    const job = (await res.json()).data;
    expect(job.kind).toBe("discover");
    expect(job.status).toBe("done");
  }).toPass({ timeout: 30_000 });
  await page.goto("/en/pipeline");
  //    Then poll until the submit button appears (fresh channels) or the videos already
  //    show up under "Just finished" (re-run on an already-imported stack).
  const submit = page.getByRole("button", { name: /^Send \d+ · skip the rest$/ });
  const done = page.getByRole("region", { name: "Just finished" });
  const imported = done.getByText("AAPL 財報解讀");
  await expect(async () => {
    await page.reload();
    await expect(submit.or(imported).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  if (await submit.isVisible()) {
    const inbox = page.getByRole("region", { name: "① To decide" });
    for (const box of await inbox.getByRole("checkbox").all()) await box.check();
    await submit.click();
    await expect(page).toHaveURL(/\/en\/pipeline/); // no navigation away
  }

  // 4. Watch the videos reach the right-hand bucket
  await expect(done.getByText("AAPL 財報解讀")).toBeVisible({ timeout: 30_000 });
  await expect(done.getByText("No transcript").first()).toBeVisible(); // beta_vid_1

  // 5. Dashboard: the analyzed videos and their stance chips
  await page.goto("/en");
  await expect(page.getByText("AAPL 財報解讀")).toBeVisible();
  //    The dashboard only previews the 5 newest videos; beta_vid_1 is the oldest, so the
  //    no-transcript badge is on the full feed.
  await page.goto("/en/videos");
  await expect(page.getByText(/no transcript/i).first()).toBeVisible();
  await page.goto("/en");

  // 6. Click stance chip → stock page
  await page.getByRole("link", { name: "AAPL · Buy" }).first().click();
  await expect(page).toHaveURL(/\/en\/stocks\/AAPL/);
  await expect(page.getByText("Apple Inc.")).toBeVisible();
  //    The mentions table is always shown; the timestamp and quote live on the video
  //    page, reached through the row's stance badge.
  const row = page.locator('tr[data-video-id="alpha_vid_3"]');
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: /buy/i }).click();
  await expect(page).toHaveURL(/\/en\/videos\/alpha_vid_3/);
  await page.getByRole("tab", { name: "Quotes" }).click();
  await expect(page.getByRole("button", { name: "0:12" })).toBeVisible();
  await expect(page.getByText("蘋果這季財報很強,我會買")).toBeVisible();

  // 7. Channel detail page: stats + video list with status badges
  await page.goto("/en/channels");
  await page.getByRole("link", { name: "頻道 Alpha" }).click();
  await expect(page).toHaveURL(/\/en\/channels\/UC_fake_alpha/);
  await expect(page.getByRole("tab", { name: "Track record" })).toBeVisible();
  await page.getByRole("tab", { name: "Videos" }).click();
  await expect(page.getByText("AAPL 財報解讀")).toBeVisible();
  await expect(page.getByText(/^analyzed$/i).first()).toBeVisible();
});

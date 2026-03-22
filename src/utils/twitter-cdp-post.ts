/**
 * Twitter CDP Post -- connects to an already-running Chrome via CDP and posts a tweet.
 * Usage: bun run src/utils/twitter-cdp-post.ts "your tweet text"
 */

import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";

async function postViaCDP(text: string) {
  console.log(`[twitter-cdp] Connecting to Chrome at ${CDP_URL}...`);
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log(`[twitter-cdp] Connected. Contexts: ${browser.contexts().length}`);

  const context = browser.contexts()[0];
  if (!context) {
    console.error("[twitter-cdp] No browser context found");
    process.exit(1);
  }

  const page = await context.newPage();

  try {
    console.log("[twitter-cdp] Navigating to x.com...");
    await page.goto("https://x.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Check logged in
    const loggedIn = await page
      .locator('[data-testid="tweetTextarea_0"], [data-testid="SideNav_NewTweet_Button"]')
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!loggedIn) {
      console.error("[twitter-cdp] Not logged in to X!");
      await page.screenshot({ path: "logs/cdp-not-logged-in.png", fullPage: true });
      process.exit(1);
    }

    console.log("[twitter-cdp] Logged in. Opening composer...");

    // Click compose button
    const composeBtn = page.locator('[data-testid="SideNav_NewTweet_Button"]');
    if (await composeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await composeBtn.click();
      await page.waitForTimeout(1500);
    }

    // Find textarea and type
    const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
    const visible = await textarea.isVisible({ timeout: 8000 }).catch(() => false);
    if (!visible) {
      console.error("[twitter-cdp] No compose textarea found");
      await page.screenshot({ path: "logs/cdp-no-textarea.png", fullPage: true });
      process.exit(1);
    }

    await textarea.click();
    await page.waitForTimeout(500);
    await textarea.fill(text);
    await page.waitForTimeout(1000);

    // Verify text entered
    const content = await textarea.textContent();
    if (!content || content.trim().length === 0) {
      console.log("[twitter-cdp] Fill failed, typing manually...");
      await textarea.click();
      await page.keyboard.type(text, { delay: 30 });
      await page.waitForTimeout(1000);
    }

    console.log("[twitter-cdp] Clicking Post...");
    const postBtn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
    const enabled = await postBtn.isEnabled({ timeout: 5000 }).catch(() => false);

    if (!enabled) {
      console.error("[twitter-cdp] Post button not enabled");
      await page.screenshot({ path: "logs/cdp-post-disabled.png", fullPage: true });
      process.exit(1);
    }

    await postBtn.click();
    await page.waitForTimeout(3000);

    // Check for errors
    const errorToast = await page
      .locator('[data-testid="toast"] span, [role="alert"]')
      .first()
      .textContent({ timeout: 2000 })
      .catch(() => null);

    if (errorToast && errorToast.toLowerCase().includes("already")) {
      console.error(`[twitter-cdp] X rejected: ${errorToast}`);
      process.exit(1);
    }

    console.log(`[twitter-cdp] Tweet posted successfully!`);
    console.log(`[twitter-cdp] Text: "${text}"`);
  } finally {
    await page.close();
    // Don't close browser -- it's the user's Chrome
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun run src/utils/twitter-cdp-post.ts \"your tweet text\"");
  process.exit(1);
}

const tweetText = args.join(" ");
if (tweetText.length > 280) {
  console.error(`Tweet too long: ${tweetText.length}/280 chars`);
  process.exit(1);
}

await postViaCDP(tweetText);

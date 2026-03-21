/**
 * Twitter Browser Automation
 *
 * Uses Playwright with a persistent Chromium session to post tweets to X.
 * Reuses a logged-in session stored at ~/.twitter-session so you only
 * need to log in once manually.
 *
 * Exports: postTweet(text), postThread(tweets)
 * CLI:     bun run src/utils/twitter-browser.ts "your tweet text"
 *          bun run src/utils/twitter-browser.ts --thread "tweet 1" "tweet 2" "tweet 3"
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";

const SESSION_DIR = join(homedir(), ".twitter-session");
const LOGS_DIR = join(import.meta.dir, "../../logs");
const X_URL = "https://x.com";

// Ensure directories exist
if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });

async function saveFailureScreenshot(page: Page, label: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(LOGS_DIR, `twitter-fail-${label}-${timestamp}.png`);
  await page.screenshot({ path, fullPage: true });
  console.error(`[twitter-browser] Screenshot saved: ${path}`);
  return path;
}

async function launchBrowser(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  return context;
}

async function waitForXReady(page: Page): Promise<boolean> {
  // Navigate to X and wait for the page to settle
  await page.goto(X_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3000);

  // Check if we're logged in by looking for the compose tweet area or the post button
  const loggedIn = await page
    .locator('[data-testid="tweetTextarea_0"], [data-testid="SideNav_NewTweet_Button"]')
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  if (!loggedIn) {
    console.error(
      "[twitter-browser] Not logged in. Open the browser manually to log in:\n" +
        `  bunx playwright open --save-storage="${SESSION_DIR}" https://x.com`
    );
    await saveFailureScreenshot(page, "not-logged-in");
    return false;
  }

  return true;
}

async function composeTweet(page: Page, text: string): Promise<boolean> {
  // Click the compose button in the sidebar to open fresh composer
  const composeBtn = page.locator('[data-testid="SideNav_NewTweet_Button"]');
  if (await composeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await composeBtn.click();
    await page.waitForTimeout(1500);
  }

  // Find the tweet textarea
  const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
  const visible = await textarea.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) {
    console.error("[twitter-browser] Could not find tweet compose area");
    await saveFailureScreenshot(page, "no-textarea");
    return false;
  }

  // Click and type the tweet text
  await textarea.click();
  await page.waitForTimeout(500);

  // Type character by character for reliability, but use fill for speed on long text
  await textarea.fill(text);
  await page.waitForTimeout(1000);

  // Verify text was entered
  const enteredText = await textarea.textContent();
  if (!enteredText || enteredText.trim().length === 0) {
    // Fallback: type it out
    await textarea.click();
    await page.keyboard.type(text, { delay: 30 });
    await page.waitForTimeout(1000);
  }

  return true;
}

async function clickPost(page: Page): Promise<boolean> {
  // The post button inside the compose dialog
  const postBtn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
  const enabled = await postBtn.isEnabled({ timeout: 5000 }).catch(() => false);

  if (!enabled) {
    console.error("[twitter-browser] Post button not found or not enabled");
    await saveFailureScreenshot(page, "post-disabled");
    return false;
  }

  await postBtn.click();
  await page.waitForTimeout(3000);

  // Check for errors (like duplicate tweet warnings)
  const errorToast = await page
    .locator('[data-testid="toast"] span, [role="alert"]')
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);

  if (errorToast && errorToast.toLowerCase().includes("already")) {
    console.error(`[twitter-browser] X rejected the tweet: ${errorToast}`);
    await saveFailureScreenshot(page, "rejected");
    return false;
  }

  return true;
}

// ============================================================
// PUBLIC API
// ============================================================

export async function postTweet(text: string): Promise<{ success: boolean; error?: string }> {
  if (text.length > 280) {
    return { success: false, error: `Tweet exceeds 280 chars (${text.length})` };
  }

  let context: BrowserContext | null = null;

  try {
    context = await launchBrowser();
    const page = context.pages()[0] || (await context.newPage());

    const ready = await waitForXReady(page);
    if (!ready) {
      return { success: false, error: "Not logged in to X. Run manual login first." };
    }

    const composed = await composeTweet(page, text);
    if (!composed) {
      return { success: false, error: "Failed to compose tweet" };
    }

    const posted = await clickPost(page);
    if (!posted) {
      return { success: false, error: "Failed to click Post button" };
    }

    console.log(`[twitter-browser] Tweet posted: "${text.substring(0, 60)}..."`);
    return { success: true };
  } catch (err: any) {
    console.error(`[twitter-browser] Error: ${err.message}`);
    if (context) {
      const page = context.pages()[0];
      if (page) await saveFailureScreenshot(page, "exception");
    }
    return { success: false, error: err.message };
  } finally {
    if (context) await context.close();
  }
}

export async function postThread(tweets: string[]): Promise<{ success: boolean; posted: number; error?: string }> {
  if (tweets.length === 0) {
    return { success: false, posted: 0, error: "No tweets provided" };
  }

  for (let i = 0; i < tweets.length; i++) {
    if (tweets[i].length > 280) {
      return { success: false, posted: 0, error: `Tweet ${i + 1} exceeds 280 chars (${tweets[i].length})` };
    }
  }

  let context: BrowserContext | null = null;

  try {
    context = await launchBrowser();
    const page = context.pages()[0] || (await context.newPage());

    const ready = await waitForXReady(page);
    if (!ready) {
      return { success: false, posted: 0, error: "Not logged in to X" };
    }

    // Open compose for first tweet
    const composeBtn = page.locator('[data-testid="SideNav_NewTweet_Button"]');
    if (await composeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await composeBtn.click();
      await page.waitForTimeout(1500);
    }

    // Type first tweet
    const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
    await textarea.click();
    await textarea.fill(tweets[0]);
    await page.waitForTimeout(1000);

    // Add remaining tweets in thread
    for (let i = 1; i < tweets.length; i++) {
      // Click "Add another tweet" button
      const addBtn = page.locator('[data-testid="addButton"]');
      const addVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!addVisible) {
        console.error(`[twitter-browser] Could not find "add tweet" button for tweet ${i + 1}`);
        await saveFailureScreenshot(page, `no-add-btn-${i}`);
        return { success: false, posted: 0, error: `Could not add tweet ${i + 1} to thread` };
      }
      await addBtn.click();
      await page.waitForTimeout(1000);

      // Type into the new textarea (it gets a higher index)
      const nextTextarea = page.locator(`[data-testid="tweetTextarea_${i}"]`).first();
      await nextTextarea.click();
      await nextTextarea.fill(tweets[i]);
      await page.waitForTimeout(800);
    }

    // Post the thread
    const posted = await clickPost(page);
    if (!posted) {
      return { success: false, posted: 0, error: "Failed to post thread" };
    }

    console.log(`[twitter-browser] Thread posted: ${tweets.length} tweets`);
    return { success: true, posted: tweets.length };
  } catch (err: any) {
    console.error(`[twitter-browser] Thread error: ${err.message}`);
    if (context) {
      const page = context.pages()[0];
      if (page) await saveFailureScreenshot(page, "thread-exception");
    }
    return { success: false, posted: 0, error: err.message };
  } finally {
    if (context) await context.close();
  }
}

// ============================================================
// CLI MODE
// ============================================================

const isMainModule = process.argv[1]?.endsWith("twitter-browser.ts");

if (isMainModule) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log('  bun run src/utils/twitter-browser.ts "your tweet text"');
    console.log('  bun run src/utils/twitter-browser.ts --thread "tweet 1" "tweet 2"');
    process.exit(0);
  }

  if (args[0] === "--thread") {
    const tweets = args.slice(1);
    if (tweets.length < 2) {
      console.error("Thread requires at least 2 tweets");
      process.exit(1);
    }
    const result = await postThread(tweets);
    if (result.success) {
      console.log(`Thread posted successfully (${result.posted} tweets)`);
    } else {
      console.error(`Thread failed: ${result.error}`);
      process.exit(1);
    }
  } else {
    const text = args.join(" ");
    const result = await postTweet(text);
    if (result.success) {
      console.log("Tweet posted successfully");
    } else {
      console.error(`Tweet failed: ${result.error}`);
      process.exit(1);
    }
  }
}

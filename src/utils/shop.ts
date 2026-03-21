/**
 * Shopping Utilities
 *
 * Handles staples list management, preference loading, Chrome MCP session
 * spawning for Uber Eats shopping, and screenshot management.
 */

import { spawn } from "bun";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { sendTelegramPhoto, stripEmDashes } from "./telegram.ts";

const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));
const STAPLES_PATH = join(PROJECT_ROOT, "config", "shop-staples.json");
const PREFERENCES_PATH = join(PROJECT_ROOT, "config", "shop-preferences.json");
const SCREENSHOT_DIR = join(PROJECT_ROOT, "temp", "shop-screenshots");
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// ============================================================
// STAPLES LIST MANAGEMENT
// ============================================================

export interface StaplesData {
  staples: string[];
  preferred_stores: string[];
  food_preferences: {
    organic_preferred: boolean;
    dietary_restrictions: string[];
    cuisine_preferences: string[];
  };
  typical_budget: {
    grocery_run: number | null;
    takeout_order: number | null;
  };
}

export async function loadStaples(): Promise<StaplesData> {
  try {
    const content = await readFile(STAPLES_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      staples: [],
      preferred_stores: [],
      food_preferences: {
        organic_preferred: true,
        dietary_restrictions: [],
        cuisine_preferences: [],
      },
      typical_budget: { grocery_run: null, takeout_order: null },
    };
  }
}

export async function saveStaples(data: StaplesData): Promise<void> {
  await writeFile(STAPLES_PATH, JSON.stringify(data, null, 2));
}

export async function addStaple(item: string): Promise<string> {
  const data = await loadStaples();
  const normalized = item.trim().toLowerCase();
  if (data.staples.some((s) => s.toLowerCase() === normalized)) {
    return `"${item}" is already on your staples list.`;
  }
  data.staples.push(item.trim());
  await saveStaples(data);
  return `Added "${item.trim()}" to your staples list.`;
}

export async function removeStaple(item: string): Promise<string> {
  const data = await loadStaples();
  const normalized = item.trim().toLowerCase();
  const idx = data.staples.findIndex((s) => s.toLowerCase() === normalized);
  if (idx === -1) {
    return `"${item}" is not on your staples list.`;
  }
  data.staples.splice(idx, 1);
  await saveStaples(data);
  return `Removed "${item.trim()}" from your staples list.`;
}

export function formatStaplesList(data: StaplesData): string {
  if (data.staples.length === 0) {
    return (
      "*Grocery Staples*\n\n" +
      "Your staples list is empty.\n\n" +
      "Add items with: /shop staples add [item]\n" +
      "Example: /shop staples add milk"
    );
  }

  const items = data.staples.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  return (
    `*Grocery Staples* (${data.staples.length} items)\n\n` +
    `${items}\n\n` +
    `Add: /shop staples add [item]\n` +
    `Remove: /shop staples remove [item]`
  );
}

// ============================================================
// PREFERENCES
// ============================================================

export interface ShopPreferences {
  learned_from_history: boolean;
  frequent_items: string[];
  favorite_restaurants: string[];
  order_history_summary: string[];
}

export async function loadPreferences(): Promise<ShopPreferences> {
  try {
    const content = await readFile(PREFERENCES_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      learned_from_history: false,
      frequent_items: [],
      favorite_restaurants: [],
      order_history_summary: [],
    };
  }
}

export async function savePreferences(prefs: ShopPreferences): Promise<void> {
  await writeFile(PREFERENCES_PATH, JSON.stringify(prefs, null, 2));
}

// ============================================================
// SCREENSHOT MANAGEMENT
// ============================================================

export async function getScreenshotDir(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(SCREENSHOT_DIR, timestamp);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Find screenshot files in a directory
 */
async function findScreenshots(dir: string): Promise<string[]> {
  const { readdir } = await import("fs/promises");
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
      .map((f) => join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

// ============================================================
// CHROME MCP SESSION SPAWNING
// ============================================================

export interface ShopSession {
  mode: "groceries" | "takeout" | "reorder" | "history";
  items?: string[];
  store?: string;
  restaurant?: string;
  cuisine?: string;
}

/**
 * Build the shopping prompt for a Chrome MCP session
 */
function buildShoppingPrompt(
  session: ShopSession,
  agentSystemPrompt: string,
  staples: StaplesData,
  preferences: ShopPreferences,
  screenshotDir: string
): string {
  const parts: string[] = [
    agentSystemPrompt,
    "",
    `Current time: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`,
    "",
  ];

  // Add preferences context
  if (preferences.learned_from_history) {
    if (preferences.frequent_items.length > 0) {
      parts.push(`Frequently ordered items: ${preferences.frequent_items.join(", ")}`);
    }
    if (preferences.favorite_restaurants.length > 0) {
      parts.push(`Favorite restaurants: ${preferences.favorite_restaurants.join(", ")}`);
    }
  }
  if (staples.preferred_stores.length > 0) {
    parts.push(`Preferred grocery stores: ${staples.preferred_stores.join(", ")}`);
  }
  if (staples.food_preferences.organic_preferred) {
    parts.push(`Preference: organic/natural options when available`);
  }
  if (staples.food_preferences.dietary_restrictions.length > 0) {
    parts.push(`Dietary restrictions: ${staples.food_preferences.dietary_restrictions.join(", ")}`);
  }

  parts.push("");

  // Mode-specific instructions
  if (session.mode === "groceries") {
    const itemList = session.items?.join(", ") || "staples list";
    parts.push(
      `## Task: Grocery Shopping on Uber Eats`,
      "",
      `Items to buy: ${itemList}`,
      "",
      `Instructions:`,
      `1. Open https://www.ubereats.com/ in the browser`,
      `2. Dismiss any pop-ups, modals, or overlays immediately`,
      `3. Navigate to the grocery section`,
      session.store
        ? `4. Go to the store: ${session.store}`
        : `4. Select the best grocery store available (prefer stores from the preferred list if any)`,
      `5. Search for each item on the list one by one`,
      `6. For each item, select the best match (prefer organic/healthy options)`,
      `7. If an exact item is not available, pick the closest substitute`,
      `8. Add all items to the cart`,
      `9. Take a screenshot of the cart showing all items and prices`,
      `10. Save the screenshot to: ${screenshotDir}`,
      "",
      `After adding all items to cart:`,
      `- Take a screenshot of the full cart`,
      `- Report a summary of: each item found with price, any substitutions made, and the cart total`,
      `- Do NOT proceed to checkout yet - wait for approval`,
    );
  } else if (session.mode === "takeout") {
    const what = session.cuisine || session.restaurant || "something good";
    parts.push(
      `## Task: Takeout Order on Uber Eats`,
      "",
      `Looking for: ${what}`,
      "",
      `Instructions:`,
      `1. Open https://www.ubereats.com/ in the browser`,
      `2. Dismiss any pop-ups, modals, or overlays immediately`,
      session.restaurant
        ? `3. Search for the restaurant: ${session.restaurant}`
        : `3. Browse restaurants matching: ${what}`,
      `4. Prefer restaurants from the favorites list if any match`,
      `5. Select a restaurant and browse the menu`,
      `6. Pick items that match the request and preferences`,
      `7. Add items to cart`,
      `8. Take a screenshot of the cart showing all items and prices`,
      `9. Save the screenshot to: ${screenshotDir}`,
      "",
      `After building the cart:`,
      `- Take a screenshot of the full cart`,
      `- Report: restaurant name, items selected with prices, cart total`,
      `- Do NOT proceed to checkout yet - wait for approval`,
    );
  } else if (session.mode === "reorder") {
    parts.push(
      `## Task: Reorder Previous Order on Uber Eats`,
      "",
      `Instructions:`,
      `1. Open https://www.ubereats.com/ in the browser`,
      `2. Dismiss any pop-ups, modals, or overlays immediately`,
      `3. Go to order history / past orders`,
      `4. Find the most recent order (or let the user specify which one)`,
      `5. Reorder it`,
      `6. Take a screenshot of the cart`,
      `7. Save the screenshot to: ${screenshotDir}`,
      "",
      `After reordering:`,
      `- Take a screenshot of the full cart`,
      `- Report: what was reordered, from where, cart total`,
      `- Do NOT proceed to checkout yet - wait for approval`,
    );
  } else if (session.mode === "history") {
    parts.push(
      `## Task: Learn Shopping Preferences from Uber Eats History`,
      "",
      `Instructions:`,
      `1. Open https://www.ubereats.com/ in the browser`,
      `2. Dismiss any pop-ups, modals, or overlays immediately`,
      `3. Go to order history / past orders`,
      `4. Review as many past orders as you can see`,
      `5. Analyze and report:`,
      `   - Which grocery stores are used most frequently?`,
      `   - What items are reordered frequently? (these should become staples)`,
      `   - Which restaurants are ordered from most?`,
      `   - What types of food/cuisine are preferred?`,
      `   - What is the typical order size and budget range?`,
      `6. Return a structured JSON summary with these fields:`,
      `   - frequent_items: string[]`,
      `   - favorite_restaurants: string[]`,
      `   - preferred_stores: string[]`,
      `   - cuisine_preferences: string[]`,
      `   - typical_grocery_budget: number (estimate)`,
      `   - typical_takeout_budget: number (estimate)`,
    );
  }

  parts.push(
    "",
    `## Pop-up Dismissal Rules (CRITICAL)`,
    `- Dismiss ALL survey pop-ups immediately without engaging`,
    `- Dismiss rewards/cashback browser extension offers`,
    `- Dismiss newsletter signup modals`,
    `- Dismiss cookie consent banners (accept necessary only)`,
    `- Close promo overlays and app download prompts`,
    `- Close any windows/tabs not part of the shopping flow`,
    `- Do NOT engage with chat widgets`,
    `- If a pop-up blocks the workflow and cannot be dismissed, describe it in your response`,
  );

  return parts.join("\n");
}

/**
 * Spawn a Claude Code session with Chrome MCP tools for shopping
 */
export async function spawnShoppingSession(
  session: ShopSession,
  agentSystemPrompt: string
): Promise<{ response: string; screenshots: string[] }> {
  const staples = await loadStaples();
  const preferences = await loadPreferences();
  const screenshotDir = await getScreenshotDir();

  const prompt = buildShoppingPrompt(
    session,
    agentSystemPrompt,
    staples,
    preferences,
    screenshotDir
  );

  console.log(`[head-procurement] Spawning Chrome session for ${session.mode}...`);

  const args = [
    CLAUDE_PATH,
    "-p",
    prompt,
    "--model",
    "sonnet",
    "--output-format",
    "text",
  ];

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[head-procurement] Chrome session error:`, stderr);
      return {
        response: `Shopping session encountered an error: ${stderr || "Claude exited with code " + exitCode}`,
        screenshots: [],
      };
    }

    // Find any screenshots that were saved
    const screenshots = await findScreenshots(screenshotDir);

    return {
      response: stripEmDashes(output.trim()),
      screenshots,
    };
  } catch (error: any) {
    console.error(`[head-procurement] Spawn error:`, error);
    return {
      response: `Could not start shopping session: ${error.message || error}`,
      screenshots: [],
    };
  }
}

/**
 * Spawn a checkout session (assumes cart is already built)
 */
export async function spawnCheckoutSession(
  agentSystemPrompt: string
): Promise<{ response: string; screenshots: string[] }> {
  const screenshotDir = await getScreenshotDir();

  const prompt = [
    agentSystemPrompt,
    "",
    `## Task: Proceed to Checkout on Uber Eats`,
    "",
    `The cart has been approved. Now proceed to checkout.`,
    "",
    `Instructions:`,
    `1. The Uber Eats cart should still be open in the browser`,
    `2. Dismiss any pop-ups or overlays`,
    `3. Click the checkout / review order button`,
    `4. Review the checkout page`,
    `5. Take a screenshot showing: subtotal, delivery fee, service fee, tip, and total`,
    `6. Save the screenshot to: ${screenshotDir}`,
    `7. Report the full breakdown: subtotal, delivery fee, service fee, tip, estimated total`,
    `8. STOP HERE - do NOT click "Place Order" or any equivalent purchase button`,
    `9. Wait for the final approval before placing the order`,
    "",
    `## Pop-up Dismissal Rules (CRITICAL)`,
    `- Dismiss ALL pop-ups immediately without engaging`,
    `- Close any promo overlays, rewards offers, or newsletter modals`,
  ].join("\n");

  console.log(`[head-procurement] Spawning checkout session...`);

  const args = [
    CLAUDE_PATH,
    "-p",
    prompt,
    "--model",
    "sonnet",
    "--output-format",
    "text",
  ];

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[head-procurement] Checkout session error:`, stderr);
      return {
        response: `Checkout session error: ${stderr || "exited with code " + exitCode}`,
        screenshots: [],
      };
    }

    const screenshots = await findScreenshots(screenshotDir);
    return { response: stripEmDashes(output.trim()), screenshots };
  } catch (error: any) {
    console.error(`[head-procurement] Checkout spawn error:`, error);
    return {
      response: `Could not start checkout session: ${error.message || error}`,
      screenshots: [],
    };
  }
}

/**
 * Spawn a session to place the final order (after checkout approval)
 */
export async function spawnPlaceOrderSession(
  agentSystemPrompt: string
): Promise<{ response: string; screenshots: string[] }> {
  const screenshotDir = await getScreenshotDir();

  const prompt = [
    agentSystemPrompt,
    "",
    `## Task: Place the Order on Uber Eats`,
    "",
    `The checkout has been approved by the CEO. Place the order now.`,
    "",
    `Instructions:`,
    `1. The Uber Eats checkout page should still be open in the browser`,
    `2. Dismiss any pop-ups or overlays`,
    `3. Click "Place Order" or the equivalent purchase button`,
    `4. Wait for the order confirmation page`,
    `5. Take a screenshot of the order confirmation`,
    `6. Save the screenshot to: ${screenshotDir}`,
    `7. Report: order confirmed, estimated delivery time, order number if visible`,
    "",
    `## Pop-up Dismissal Rules (CRITICAL)`,
    `- Dismiss ALL pop-ups immediately without engaging`,
  ].join("\n");

  console.log(`[head-procurement] Spawning place-order session...`);

  const args = [
    CLAUDE_PATH,
    "-p",
    prompt,
    "--model",
    "sonnet",
    "--output-format",
    "text",
  ];

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[head-procurement] Place order error:`, stderr);
      return {
        response: `Place order error: ${stderr || "exited with code " + exitCode}`,
        screenshots: [],
      };
    }

    const screenshots = await findScreenshots(screenshotDir);
    return { response: stripEmDashes(output.trim()), screenshots };
  } catch (error: any) {
    console.error(`[head-procurement] Place order spawn error:`, error);
    return {
      response: `Could not place order: ${error.message || error}`,
      screenshots: [],
    };
  }
}

/**
 * Spawn a history learning session
 */
export async function spawnHistorySession(
  agentSystemPrompt: string
): Promise<{ response: string; preferences: Partial<ShopPreferences> | null }> {
  const session: ShopSession = { mode: "history" };
  const result = await spawnShoppingSession(session, agentSystemPrompt);

  // Try to extract JSON preferences from the response
  let preferences: Partial<ShopPreferences> | null = null;
  try {
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      preferences = {
        learned_from_history: true,
        frequent_items: parsed.frequent_items || [],
        favorite_restaurants: parsed.favorite_restaurants || [],
        order_history_summary: parsed.order_history_summary || [],
      };

      // Also update staples with learned data
      if (parsed.preferred_stores || parsed.cuisine_preferences || parsed.typical_grocery_budget) {
        const staples = await loadStaples();
        if (parsed.preferred_stores) staples.preferred_stores = parsed.preferred_stores;
        if (parsed.cuisine_preferences) {
          staples.food_preferences.cuisine_preferences = parsed.cuisine_preferences;
        }
        if (parsed.typical_grocery_budget) {
          staples.typical_budget.grocery_run = parsed.typical_grocery_budget;
        }
        if (parsed.typical_takeout_budget) {
          staples.typical_budget.takeout_order = parsed.typical_takeout_budget;
        }
        await saveStaples(staples);
      }
    }
  } catch {
    // If we can't parse JSON, just return the text response
  }

  return { response: result.response, preferences };
}

/**
 * Check if a shopping session response indicates CAPTCHA or login issues
 */
export function detectLoginIssues(response: string): boolean {
  const lower = response.toLowerCase();
  const indicators = [
    "captcha",
    "sign in",
    "log in",
    "login",
    "verify your",
    "verification",
    "not logged in",
    "session expired",
    "please authenticate",
  ];
  return indicators.some((ind) => lower.includes(ind));
}

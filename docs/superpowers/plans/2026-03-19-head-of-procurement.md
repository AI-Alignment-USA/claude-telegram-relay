# Head of Procurement (Shopping Agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Head of Procurement agent to the Tamille fleet that handles grocery and takeout ordering via Uber Eats with Chrome browser automation.

**Architecture:** On-demand agent triggered via `/shop` Telegram commands. Spawns Claude Code sessions with Chrome MCP tools to navigate Uber Eats. Two approval gates (cart review, checkout review) via Telegram inline buttons before any purchase. Preferences and staples stored in local JSON files.

**Tech Stack:** TypeScript/Bun, grammy (Telegram), Chrome MCP (browser automation), Claude CLI, Supabase (task tracking)

**Spec:** `docs/superpowers/specs/2026-03-19-head-of-procurement-design.md`

---

### Task 1: Agent Config - System Prompt

**Files:**
- Create: `config/agents/head-procurement.md`

- [ ] **Step 1: Create the agent system prompt**

Write `config/agents/head-procurement.md` with:
- Role definition (Head of Procurement, grocery/takeout ordering via Uber Eats)
- Shopping flow instructions (browse, search, add to cart, screenshot)
- Pop-up dismissal rules (surveys, rewards, cookies, newsletters, extra tabs)
- Uber Eats navigation guidance (grocery section, restaurant browsing)
- Item selection preferences (prefer organic, match user history)
- Screenshot requirements (cart summary, checkout totals)
- CISO security protocols (canary token, input sanitization, data isolation, context reset guard, semantic override detection, CEO feedback whitelist)
- Communication style (practical, concise, no em dashes)

- [ ] **Step 2: Commit**

```bash
git add config/agents/head-procurement.md
git commit -m "feat: add Head of Procurement agent system prompt"
```

---

### Task 2: Agent Registration

**Files:**
- Modify: `src/agents/registry.ts` (add agent definition to AGENT_DEFS array)
- Modify: `src/agents/router.ts` (add /shop to COMMAND_MAP, add natural language triggers)

- [ ] **Step 1: Add agent to registry**

In `src/agents/registry.ts`, add to the `AGENT_DEFS` array:

```typescript
{
  id: "head-procurement",
  name: "Head of Procurement",
  role: "Head of Procurement (Shopping & Orders)",
  modelDefault: "sonnet",
  modelEscalated: "opus",
  autonomyDefault: 2,
  constraints: [
    "NEVER auto-purchase without explicit /approved from user",
    "NEVER use em dashes in any output",
  ],
},
```

- [ ] **Step 2: Add /shop to router command map**

In `src/agents/router.ts`, add to `COMMAND_MAP`:

```typescript
"/shop": "head-procurement",
"/procurement": "head-procurement",
```

- [ ] **Step 3: Add natural language triggers for shopping**

In `src/agents/router.ts`, add shopping triggers similar to `WELLNESS_TRIGGERS`:

```typescript
const SHOPPING_TRIGGERS = [
  "i need groceries",
  "order groceries",
  "order dinner",
  "order takeout",
  "order food",
  "i want sushi",
  "i want pizza",
  "i'm hungry",
  "im hungry",
  "get me food",
  "uber eats",
];

export function isShoppingTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return SHOPPING_TRIGGERS.some((t) => lower.includes(t));
}
```

- [ ] **Step 4: Commit**

```bash
git add src/agents/registry.ts src/agents/router.ts
git commit -m "feat: register Head of Procurement agent and /shop command"
```

---

### Task 3: Staples List Management

**Files:**
- Create: `config/shop-staples.json` (initial empty staples)
- Create: `config/shop-preferences.json` (initial empty preferences)
- Create: `src/utils/shop.ts` (staples CRUD, preferences loading)

- [ ] **Step 1: Create initial data files**

Create `config/shop-staples.json`:

```json
{
  "staples": [],
  "preferred_stores": [],
  "food_preferences": {
    "organic_preferred": true,
    "dietary_restrictions": [],
    "cuisine_preferences": []
  },
  "typical_budget": {
    "grocery_run": null,
    "takeout_order": null
  }
}
```

Create `config/shop-preferences.json`:

```json
{
  "learned_from_history": false,
  "frequent_items": [],
  "favorite_restaurants": [],
  "order_history_summary": []
}
```

- [ ] **Step 2: Create shop utility module**

Create `src/utils/shop.ts` with:
- `loadStaples()` / `saveStaples()` - read/write `config/shop-staples.json`
- `addStaple(item: string)` - add item to staples list
- `removeStaple(item: string)` - remove item from staples list
- `getStaplesList()` - return formatted staples list string
- `loadPreferences()` - read `config/shop-preferences.json`
- `savePreferences(prefs)` - write preferences
- `sendTelegramPhoto(photoPath: string, caption?: string)` - send a screenshot to Telegram via Bot API `sendPhoto` endpoint
- `getScreenshotDir()` - return and ensure `temp/shop-screenshots/` exists

All functions use `fs/promises` for file I/O. Photo sending uses the Telegram Bot API `sendPhoto` with `multipart/form-data` to upload local files.

- [ ] **Step 3: Commit**

```bash
git add config/shop-staples.json config/shop-preferences.json src/utils/shop.ts
git commit -m "feat: add shop utilities, staples list, and preferences storage"
```

---

### Task 4: Chrome MCP Shopping Session Spawner

**Files:**
- Modify: `src/utils/shop.ts` (add Chrome session spawning)

- [ ] **Step 1: Add Chrome session spawner**

Add to `src/utils/shop.ts`:

```typescript
export interface ShopSession {
  mode: "groceries" | "takeout" | "reorder" | "history";
  items?: string[];
  store?: string;
  restaurant?: string;
  cuisine?: string;
}

export async function spawnShoppingSession(
  session: ShopSession,
  agentPrompt: string,
  preferences: any
): Promise<{ response: string; screenshots: string[] }>
```

This function:
1. Builds a detailed prompt combining the agent system prompt, shopping instructions, preferences context, and pop-up dismissal rules
2. Creates the screenshot output directory (`temp/shop-screenshots/<timestamp>/`)
3. Spawns `claude -p <prompt> --model sonnet --output-format json` using Bun's `spawn()`
4. The prompt instructs Claude to:
   - Open Uber Eats in Chrome
   - Navigate to groceries or restaurants based on mode
   - Search for items / browse restaurants
   - Add items to cart
   - Take screenshots using `mcp__claude-in-chrome__computer` (screenshot action) and save them
   - Return a JSON summary of items found, prices, substitutions, and screenshot paths
5. Parses the response and returns items summary + screenshot file paths

- [ ] **Step 2: Add checkout session spawner**

Add a separate function for the checkout step:

```typescript
export async function spawnCheckoutSession(
  agentPrompt: string
): Promise<{ response: string; screenshots: string[] }>
```

This spawns a Chrome session that:
1. Assumes Uber Eats cart is still open from the previous session
2. Proceeds to checkout
3. Screenshots the final checkout page (delivery fee, tip, total)
4. STOPS before placing the order
5. Returns checkout summary + screenshot paths

- [ ] **Step 3: Add history learning session spawner**

```typescript
export async function spawnHistorySession(
  agentPrompt: string
): Promise<{ preferences: any }>
```

Spawns a Chrome session to read Uber Eats order history and return structured preference data.

- [ ] **Step 4: Commit**

```bash
git add src/utils/shop.ts
git commit -m "feat: add Chrome MCP session spawners for shopping flows"
```

---

### Task 5: Shop Command Handler in Relay

**Files:**
- Modify: `src/relay.ts` (add shop command handling, approval gates, photo sending)

- [ ] **Step 1: Add imports**

At the top of `src/relay.ts`, add:

```typescript
import { isShoppingTrigger } from "./agents/router.ts";
import {
  loadStaples,
  addStaple,
  removeStaple,
  getStaplesList,
  loadPreferences,
  savePreferences,
  spawnShoppingSession,
  spawnCheckoutSession,
  spawnHistorySession,
  sendTelegramPhoto,
  getScreenshotDir,
} from "./utils/shop.ts";
```

- [ ] **Step 2: Add handleShopCommand function**

Add a new function `handleShopCommand(ctx, text)` that parses `/shop` subcommands:

- `/shop groceries` - Start grocery flow: ask for list, then spawn Chrome session
- `/shop takeout` - Start takeout flow: ask what they want, then spawn Chrome session
- `/shop reorder` - Load last order from preferences, confirm, then spawn Chrome session
- `/shop staples` - Display current staples list
- `/shop staples add X` - Add item to staples
- `/shop staples remove X` - Remove item from staples
- `/shop history` - Spawn history learning Chrome session
- `/shop status` - Query Supabase for active shop tasks
- `/shop gift` - Reply "Coming soon!"
- `/shop` (no subcommand) - Show usage help

For grocery/takeout flows:
1. Create a task in Supabase with `task_type: "shop_groceries"` or `"shop_takeout"` and `shop_state: "awaiting_list"`
2. Reply asking what they need
3. The next message from the user (detected via pending shop task state) provides the list
4. Update task state to `"browsing"`, spawn Chrome session
5. On Chrome session completion, send screenshots + summary via Telegram
6. Update task state to `"cart_review"`, show inline buttons (Approve / Changes)
7. On Approve callback, update to `"checkout_review"`, spawn checkout Chrome session
8. Send checkout screenshot + total, show final inline buttons (Place Order / I'll Handle It)
9. On Place Order callback, spawn final Chrome session to complete purchase
10. Update task state to `"completed"`

- [ ] **Step 3: Wire shop command into message handler**

In the `bot.on("message:text")` handler, add before the agent command check:

```typescript
// Handle /shop commands
if (text.toLowerCase().startsWith("/shop")) {
  await handleShopCommand(ctx, text);
  return;
}
```

Add natural language shopping trigger routing (after wellness triggers):

```typescript
if (isShoppingTrigger(text)) {
  await handleShopCommand(ctx, `/shop ${text}`);
  return;
}
```

- [ ] **Step 4: Add shop approval callback handling**

In the `bot.on("callback_query:data")` handler, add handling for shop-specific callbacks:

- `shop_approve_cart:<taskId>` - Approve cart, move to checkout
- `shop_approve_checkout:<taskId>` - Place order (final approval)
- `shop_handle_manually:<taskId>` - User will finish manually
- `shop_change_cart:<taskId>` - User wants to adjust cart items

- [ ] **Step 5: Handle follow-up messages for active shop sessions**

In the message handler, check for active shop tasks (state: `awaiting_list` or `cart_review` with changes requested). If found:
- `awaiting_list`: User's message is the item list. Parse it and start browsing.
- `cart_review` with changes: User's message describes cart changes. Spawn Chrome session to make adjustments.

- [ ] **Step 6: Commit**

```bash
git add src/relay.ts
git commit -m "feat: add /shop command handler with approval gates and Chrome automation"
```

---

### Task 6: Telegram Photo Sending

**Files:**
- Modify: `src/utils/telegram.ts` (add sendTelegramPhoto)

- [ ] **Step 1: Add photo sending function**

Add to `src/utils/telegram.ts`:

```typescript
export async function sendTelegramPhoto(
  photoPath: string,
  caption?: string
): Promise<{ ok: boolean; messageId?: number }> {
  try {
    const file = Bun.file(photoPath);
    const blob = await file.arrayBuffer();

    const formData = new FormData();
    formData.append("chat_id", CHAT_ID);
    formData.append("photo", new Blob([blob]), "screenshot.png");
    if (caption) {
      formData.append("caption", caption);
      formData.append("parse_mode", "Markdown");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: formData }
    );

    if (!response.ok) return { ok: false };
    const data = await response.json();
    return { ok: true, messageId: data.result?.message_id };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/telegram.ts
git commit -m "feat: add sendTelegramPhoto for screenshot delivery"
```

---

### Task 7: Integration and Final Wiring

**Files:**
- Modify: `src/relay.ts` (ensure all pieces connect)

- [ ] **Step 1: Add shopping trigger routing in relay**

Verify the relay properly routes:
1. `/shop *` commands to `handleShopCommand`
2. Natural language shopping triggers to `handleShopCommand`
3. Shop approval callbacks to shop-specific handlers
4. Follow-up messages to active shop sessions

- [ ] **Step 2: Add budget warning logic**

In the shop approval handler, when showing cart total:
- Load preferences to get `typical_budget`
- If cart total > 1.5x typical budget, add a warning line to the Telegram message

- [ ] **Step 3: Add CAPTCHA/login failure detection**

In `spawnShoppingSession`, check the Claude response for indicators of being stuck:
- "captcha", "login", "sign in", "verify"
- If detected, send a Telegram message: "Shopping session needs your help - possible login or CAPTCHA issue. Check the browser."

- [ ] **Step 4: Commit**

```bash
git add src/relay.ts src/utils/shop.ts
git commit -m "feat: wire budget warnings and CAPTCHA detection into shopping flow"
```

---

### Task 8: Final Commit and Push

- [ ] **Step 1: Verify all files**

Verify these files exist and are correct:
- `config/agents/head-procurement.md`
- `config/shop-staples.json`
- `config/shop-preferences.json`
- `src/utils/shop.ts`
- `src/agents/registry.ts` (modified)
- `src/agents/router.ts` (modified)
- `src/relay.ts` (modified)
- `src/utils/telegram.ts` (modified)

- [ ] **Step 2: Final commit and push**

```bash
git add -A
git commit -m "feat: add Head of Procurement shopping agent (Phase 1 MVP)"
git push
```

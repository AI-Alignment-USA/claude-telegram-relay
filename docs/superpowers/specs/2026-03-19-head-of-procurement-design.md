# Head of Procurement (Shopping Agent) - Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Phase:** 1 - Uber Eats Grocery + Takeout MVP

## Overview

A new agent in the Tamille fleet that handles grocery shopping and takeout ordering via Uber Eats, triggered through Telegram `/shop` commands. Uses Chrome MCP browser automation (via spawned Claude Code sessions) to navigate Uber Eats, build carts, take screenshots, and manage checkout -- with two human approval gates before any purchase.

## Agent Identity

- **Name:** Head of Procurement
- **ID:** `head-procurement`
- **Telegram command:** `/shop`
- **Model:** Sonnet default, Opus escalated (complex decisions)
- **Autonomy tier:** 2 (requires CEO approval)
- **Schedule:** On-demand only, no PM2 worker needed

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/shop groceries` | Start a grocery order on Uber Eats |
| `/shop takeout` | Order takeout on Uber Eats |
| `/shop reorder` | Reorder from a previous order |
| `/shop staples` | Show saved grocery staples list |
| `/shop staples add X` | Add item to staples list |
| `/shop staples remove X` | Remove item from staples list |
| `/shop history` | Show recent orders summary |
| `/shop status` | Check status of current shopping task |
| `/shop gift` | Phase 2 - replies "Coming soon!" |

## Core Flows

### Grocery Shopping Flow

1. User sends `/shop groceries`
2. Agent asks what they need (list, "staples", or "reorder")
3. User sends item list
4. Agent spawns Chrome MCP session that:
   - Opens Uber Eats
   - Navigates to grocery section
   - Selects preferred grocery store (from learned preferences)
   - Searches for each item, picks best match (prefer organic/healthy per history)
   - Adds all items to cart
   - Screenshots the cart
5. Agent sends cart screenshot + item summary + total to Telegram
6. **Approval Gate 1:** User sends `/approved` or requests changes
7. On approval, agent spawns second Chrome session for checkout
8. Agent screenshots final checkout (delivery fee, tip, total) and sends to Telegram
9. **Approval Gate 2:** User sends final `/approved` to place order, or "I'll handle it"

### Takeout Flow

Same as grocery but browses restaurants matching the request, prefers previously-ordered restaurants.

### History Learning

On first run or `/shop history`:
1. Spawn Chrome session to read Uber Eats order history
2. Analyze patterns (stores, items, restaurants, cuisine preferences, budget)
3. Save profile to `config/shop-preferences.json`
4. Profile included as context in all future shopping prompts

## Architecture

### Chrome MCP Session Spawning

The shopping agent spawns Claude Code sessions with Chrome MCP tools:

```
claude -p <shopping-prompt> --model sonnet --output-format json
```

The shopping prompt includes:
- Full agent system prompt (from `config/agents/head-procurement.md`)
- Current shopping instructions (items, store preference, etc.)
- Learned preferences from `config/shop-preferences.json`
- Pop-up dismissal rules
- Instructions to save screenshots to `temp/shop-screenshots/`

### Session State

Shopping sessions tracked in Supabase `tasks` table with metadata:

```json
{
  "task_type": "shop_groceries" | "shop_takeout",
  "shop_state": "awaiting_list" | "browsing" | "cart_review" | "checkout_review" | "completed",
  "items_requested": ["milk", "eggs"],
  "store": "preferred store name",
  "screenshots": ["path1.png"]
}
```

### Two Approval Gates

Uses existing Telegram inline button pattern:
- Gate 1 (cart review): Approve cart contents and substitutions
- Gate 2 (checkout review): Approve final total with fees

### File Structure

```
config/agents/head-procurement.md       # Agent system prompt + security protocols
config/shop-staples.json                # User's saved staples list
config/shop-preferences.json            # Auto-populated from Uber Eats history
src/utils/shop.ts                       # Shopping utilities (Chrome spawning, screenshot handling, staples CRUD)
```

No PM2 worker or .cjs wrapper needed (on-demand only).

## Data Storage

### Staples List (`config/shop-staples.json`)

```json
{
  "staples": ["milk", "eggs", "bread", "bananas", "spinach", "chicken breast"],
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

### Learned Preferences (`config/shop-preferences.json`)

Auto-populated by history learning Chrome session. Includes:
- Frequently ordered items
- Preferred grocery stores
- Favorite restaurants
- Cuisine preferences
- Typical order sizes and budgets

## Safety Rails

1. **NEVER auto-purchase** without explicit `/approved` from user
2. **Two approval gates:** cart contents, then checkout total
3. **Always show totals** including delivery fees and service charges
4. **CAPTCHA/login detection:** if Chrome session gets stuck, notify user via Telegram
5. **Budget guardrail:** warn if order > 1.5x typical spend from preferences
6. **Pop-up handling:** dismiss all surveys, rewards offers, cookie banners, newsletter modals immediately

## Pop-up Dismissal Rules

Every Chrome session prompt includes these rules:
- Dismiss all survey pop-ups immediately - do NOT engage with them
- Dismiss rewards/cashback browser extension offers
- Dismiss newsletter signup modals
- Dismiss cookie consent banners (accept necessary only)
- Close any new windows/tabs that aren't part of the shopping flow
- If a pop-up blocks the workflow and can't be dismissed, screenshot it and notify user

## Phase 2 (Not in MVP)

- `/shop gift` - gift shopping
- Amazon ordering
- Recurring scheduled grocery orders
- COO/Household agent integration for auto-triggered orders
- Google Calendar integration for scheduled orders

---
name: tamille-agent
description: "Development skill for the Tamille Agent project -- a multi-agent AI executive team running on Telegram via PM2. Use this skill when working on any Tamille-related code: relay bot, agent prompts, API integrations, dashboard, workers, CISO patrol, voice calling, or approval workflows. Triggers on mentions of 'Tamille', 'agent', 'relay', 'telegram bot', 'PM2 worker', 'approval queue', 'CISO patrol', 'voice call', 'command center', 'dashboard', or any of the agent roles (COO, CIO, CFO, CMO, CISO, Head of Content, Head of Education, Head of Household, Head of News Room, Head of Wellness)."
---

# Tamille Agent Development Skill

## Project Overview

Tamille is a multi-agent AI executive team that runs on Telegram. Each agent has a distinct role, personality, and set of capabilities. The system uses a relay bot to route messages, a PM2-based worker system for scheduled tasks, and a web dashboard (Command Center) for approvals and monitoring.

## Architecture

```
src/
  relay.ts              # Main Telegram relay -- routes all messages
  utils/
    gumroad.ts          # Gumroad API (sales, products, listings)
    calendar.ts         # Google Calendar API (events, scheduling)
    gmail.ts            # Gmail API (search, read, draft, send)
    heygen.ts           # HeyGen API (avatar videos)
    twitter.ts          # X/Twitter API (post, delete tweets)
    quickbooks.ts       # QuickBooks Online API (P&L, balance sheet)
    voice.ts            # Twilio + ElevenLabs voice calling
    elevenlabs-agents.ts # Bidirectional conversational AI voice
    timing-guard.ts     # Prevents spurious PM2 worker execution
  workers/
    ciso-patrol.ts      # Nightly security patrol (10:45pm PT)
    [other workers]     # Scheduled via PM2 cron
dashboard/
  server.ts             # Command Center (localhost:3000, Tailscale:3001)
```

## Agent Roster and Permissions

| Agent | Tier | Voice | Key Capabilities |
|-------|------|-------|-----------------|
| COO (Tamille) | 1 (calls need approval) | Rachel | Morning/EOD briefings, calendar, task coordination |
| CISO | 1 (calls are immediate) | Adam | Security patrol, audits, direct CEO reporting |
| CIO | 2 | Charlie | Infrastructure, API integrations, Make.com flows |
| CFO | 2 | Daniel | QuickBooks, financial reports, invoice tracking |
| CMO | 2 | Bella | X posts, Gumroad copy, social strategy |
| Head of Content | 2 | Elli | Brand voice, content creation |
| Head of Education | 2 | Sarah | Thomas's progress, Kumon/school coordination |
| Head of Household | 2 | Domi | Scheduling, errands, home management |
| Head of News Room | 2 | Antoni | AI news briefings |
| Head of Wellness | Firewalled | Lily | Private check-ins, fully isolated from other agents |

### Tier System
- **Tier 1**: Actions execute immediately (CISO calls go straight through)
- **Tier 2**: Actions require CEO approval via Telegram buttons or Dashboard

### Security Model
- CISO reports directly to CEO, not through COO
- Wellness agent is fully firewalled -- COO sees only "Wellness: Active"
- All agents have canary tokens, input sanitization, context reset guards, and semantic override detection

## Key Conventions

### No Em Dashes
**CRITICAL**: Never use em dashes (--) in any content the CEO will copy and paste (texts, emails, Telegram messages, social posts). Em dashes signal AI authorship. Use commas, semicolons, periods, or rewrite the sentence instead.

### Approval Flow
1. Agent generates output
2. COO (Tamille) reviews for quality, tone, em dashes
3. Item appears in approval queue (Dashboard + Telegram buttons)
4. CEO approves or rejects
5. On approval, the callback handler executes the action (e.g., postTweet)

### Voice Calling
- One-way TTS: ElevenLabs generates audio, Twilio delivers call
- Two-way conversational: Requires ngrok for WebSocket bridge
- Fallback chain: ElevenLabs > Twilio Polly.Joanna > Twilio built-in TTS
- CISO calls skip approval (Tier 1)
- All other agent calls go through Tier 2 approval

### PM2 Workers
- All 16 workers have timing guards (check Pacific Time day/hour)
- Workers silently exit if triggered outside their scheduled window
- Prevents spurious execution on pm2 restart/reboot

## Common Development Tasks

### Adding a New API Integration
1. Create `src/utils/new-service.ts` with typed functions
2. Add credentials to `.env` (document in README)
3. Wire into the appropriate agent's prompt to grant access
4. Add CISO security checks (input sanitization, data isolation)
5. Test via Telegram command routing

### Modifying an Agent Prompt
1. Locate the agent config in the codebase
2. Update the system prompt
3. Apply CISO security patches (canary tokens, context reset guard, semantic override detection)
4. Test via Telegram: `/[agent] [test message]`

### Adding Auto-Execution on Approval
1. Open `src/relay.ts` approval callback handler
2. Add a branch for the new action type (after existing voice_call and CISO quarantine blocks)
3. Import the execution function (e.g., `postTweet` from twitter.ts)
4. Call the function with the approved task output
5. Send confirmation back to Telegram with result (e.g., tweet URL)

### Dashboard Changes
- Dashboard runs on `dashboard/server.ts`
- Auto-refresh: Overview 30s, Approvals 15s, others 60s
- Access via Tailscale (100.x.x.x:3001) or localhost:3000
- Port 3001 bind failure logs warning instead of crashing

## Environment Variables

All credentials live in `.env` at project root. Key groups:
- Telegram, Supabase, Anthropic (core infrastructure)
- Gumroad, Google (Calendar + Gmail), HeyGen, X/Twitter, QuickBooks (API integrations)
- Twilio, ElevenLabs (voice calling)
- CEO_PHONE_NUMBER, NGROK_URL (calling config)

## Testing Checklist

Before committing changes:
- [ ] Relay bot responds to test messages via Telegram
- [ ] Approval flow works (Telegram buttons + Dashboard)
- [ ] No em dashes in any user-facing output
- [ ] CISO security patches applied to any new/modified agent prompts
- [ ] Timing guards intact on any new/modified PM2 workers
- [ ] Environment variables documented

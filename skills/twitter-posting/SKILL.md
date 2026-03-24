---
name: twitter-posting
description: >
  Draft and post content to X (Twitter) for Crevita Moody's personal account. Use this skill whenever
  the user asks to post to X, tweet something, draft a tweet, create a thread, write a quote tweet,
  or anything related to X/Twitter content. Also triggered by the daily 5 AM PT automated briefing
  that presents 3 AI news post options via Telegram. Covers single posts, threads (2-5 posts),
  and quote tweets. All content uses Hook Point engagement techniques adapted to Crevita's authentic
  voice. This is a pure thought leadership account -- never include product CTAs or sales links.
  Trigger on: "post to X", "tweet", "draft a tweet", "thread", "quote tweet", "X post",
  "what should I post", "post about [topic]", "daily post options", or any reference to
  X/Twitter content creation.
---

# X/Twitter Posting Skill

## Overview

This skill handles all X (Twitter) content creation for Crevita Moody's personal account (@crevitamoody or current handle). It operates in two modes:

1. **Daily Briefing Mode** -- Triggered at 5 AM PT by the Tamille Agent scheduler. Scans latest AI news and presents 3 draft post options via Telegram for approval.
2. **On-Demand Mode** -- Triggered when Crevita asks to post, draft, or discuss X content at any time.

Before drafting any content, read `references/voice-and-hooks.md` for voice guidelines and Hook Point techniques.

---

## Content Formats

### Single Post
- Hard limit: 280 characters total
- URLs consume exactly 23 characters regardless of actual length (X's t.co wrapping)
- Effective writing space when including a link: **257 characters** for text
- Always include the source article link
- No hashtags unless they add genuine value (rare -- one max)
- No emojis unless they serve the hook (sparing use, one max)

### Thread (2-5 posts)
- Use for bigger stories that deserve context, nuance, or a personal take
- Post 1: The hook -- must stand alone and compel the click. Include "Thread:" or the thread emoji (🧵) only if it fits naturally
- Posts 2-4: Build the insight, add perspective, connect to the bigger picture
- Final post: The takeaway or call to think. Link goes here
- Each post: 280 character limit independently
- Threads should feel like a natural progression of thought, not a chopped-up article

### Quote Tweet
- Used to add Crevita's perspective to an existing post by someone else
- Keep the added commentary punchy (the quoted post provides context)
- Frame as insight, not reaction
- 280 character limit for the commentary portion

---

## Daily Briefing Mode (5 AM PT)

### Source Scanning Priority

Scan these sources for AI news from the last 24 hours, prioritized:

**Tier 1 -- Primary (check first)**
- arXiv (cs.AI, cs.CL, cs.LG) for new papers
- Official blogs: Anthropic, OpenAI, Google DeepMind, Meta AI, Mistral, xAI
- TechCrunch AI section
- The Verge AI section
- Reuters Technology
- MIT Technology Review

**Tier 2 -- Secondary**
- Ars Technica
- Wired AI coverage
- VentureBeat AI
- The Information (if accessible)
- AI-focused newsletters (The Batch, Import AI, The Rundown AI)

**Tier 3 -- Social Signal**
- Trending AI topics on X
- Notable AI researcher posts (Yann LeCun, Andrej Karpathy, etc.)

### Story Selection Criteria

Pick 3 stories that are **distinct** from each other. Aim for variety across these categories:

1. **Product/Launch** -- A new model, tool, feature, or product release
2. **Research/Breakthrough** -- A paper, finding, or technical advancement
3. **Policy/Ethics/Safety** -- Regulation, governance, safety research, societal impact
4. **Industry Move** -- Funding, acquisitions, partnerships, strategic shifts
5. **Accessibility/Education** -- AI becoming more accessible, literacy efforts, democratization

If all top stories fall in one category, still present 3 but flag this: "Heavy news day in [category] -- here are the top 3."

### Drafting the 3 Options

For each story, provide via Telegram:

```
OPTION [1/2/3]
Format: [Single Post | Thread | Quote Tweet]
Story: [1-line summary of the news]
Source: [Publication name + link]

Draft:
[The actual post text, character count shown]

[Character count: X/280]

Why this story: [1 sentence on why it's worth posting]
```

Present all 3 options, then ask:
"Which one(s) do you want to go with? I can also revise or combine."

### Approval Flow

1. Crevita reviews the 3 options in Telegram
2. She replies with approval, edits, or rejection
3. On approval, post to X via the X/Twitter API
4. Confirm posted with a link to the live post
5. If she asks for revisions, redraft and re-present. Do not post without explicit approval
6. If no response by 9 AM PT, send one follow-up nudge. If no response by 11 AM, skip the day

---

## On-Demand Mode

When Crevita asks to post or draft content:

1. Clarify the topic if vague
2. Determine format (single post, thread, or quote tweet) -- suggest the best fit
3. Draft using voice and hook guidelines from `references/voice-and-hooks.md`
4. Present the draft with character count
5. Revise if needed
6. Post only on explicit approval

---

## Voice and Hook Guidelines

Read `references/voice-and-hooks.md` for the full voice profile and Hook Point framework. Key principles at a glance:

- Write like a smart friend who happens to work in AI, not like a thought leader performing for an audience
- Lead with insight, not information
- Make the reader feel something: curiosity, surprise, urgency, or recognition
- Never sound like a press release or a LinkedIn post
- No em dashes anywhere in the content
- Contractions are good. Sentence fragments are fine. Start sentences with "And" or "But" freely
- The link is the citation, not the point. The post should add value beyond "here's an article"

---

## Character Counting Rules

This is critical. X enforces 280 characters strictly.

- Count every character including spaces and punctuation
- URLs always count as 23 characters (X shortens all links to t.co)
- Newlines count as 1 character each
- Emoji count as 2 characters each
- Always display the character count with the draft: `[X/280]`
- If a post is over 280, do not present it. Trim first

---

## Posting Guidelines

- **Frequency**: 1 post per day is the baseline. Never exceed 3 per day unless breaking news warrants it
- **Timing**: If Crevita doesn't specify, suggest optimal posting windows: 8-10 AM PT or 12-2 PM PT for maximum reach
- **Engagement awareness**: If a previous post is performing well (getting replies), suggest waiting before posting again to avoid burying it
- **Never auto-post**: Every post requires explicit approval
- **Reply strategy**: If Crevita asks, help draft replies to comments on her posts. Same voice rules apply
- **No dunking**: Even on bad takes, respond with insight not snark. Crevita's brand is "makes you smarter," not "makes others look dumb"
- **Attribution**: Always credit the source/journalist. Never imply she broke the news
- **Corrections**: If a draft contains a factual error caught before posting, fix it. If caught after posting, draft a correction post immediately

---

## Topics to Prioritize

Based on Crevita's expertise and mission:
- AI accessibility and literacy (her core mission)
- AI safety and ethics (she tracks this closely)
- AI in education and parenting
- AI policy and regulation
- New model releases and benchmarks
- Practical AI tools for non-technical people
- Data contributor rights and AI labor
- Underrepresented communities in AI

## Topics to Handle Carefully
- Anthropic news (she works adjacent to FAA, not Anthropic -- but she uses Claude extensively, so be transparent about that)
- FAA/DOT/government AI initiatives (she's a federal employee -- keep opinions measured on her own agency)
- Controversial AI figures -- focus on the substance, not the person
- AI doomerism vs. accelerationism -- she's pragmatic and nuanced, not in either camp

## Topics to Skip
- Crypto/Web3 AI projects (unless genuinely significant)
- AI-generated art drama (unless policy-relevant)
- Celebrity AI stunts
- Rage-bait takes designed purely for engagement

---

## Error Handling

- If news sources are unavailable, use what's accessible and note the gap
- If the X API is down, queue the approved post and retry every 15 minutes for 2 hours
- If character count is disputed, always recount manually before posting
- If a story turns out to be misinformation after drafting, flag it immediately and pull the draft

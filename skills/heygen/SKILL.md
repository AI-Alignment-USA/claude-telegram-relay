---
name: heygen-video-production
description: >
  Create YouTube videos using HeyGen AI avatars from blog posts or topic briefs. Use this skill
  whenever the user asks to "make a video", "create a YouTube video", "generate a HeyGen video",
  "turn this blog post into a video", "write a video script", or anything related to YouTube
  content production using AI avatars. Also trigger when the user mentions "HeyGen", "avatar video",
  "video script", "B-roll", "Video Agent", "digital twin", or references YouTube video creation.
  Covers the full pipeline: scriptwriting from blog posts, HeyGen avatar selection and rotation,
  video generation via API or browser, B-roll integration, review/approval gate, YouTube upload,
  and social distribution (LinkedIn and X/Twitter captions). Trigger on: "video", "HeyGen",
  "YouTube video", "script", "avatar", "make a video about", "turn this into a video",
  "video from blog", "B-roll", "Video Agent", or any reference to video content creation.
---

# HeyGen Video Production Skill

## Overview

This skill handles the end-to-end production of YouTube videos using HeyGen AI avatars. The typical flow is: take a blog post (or topic brief), transform it into a HeyGen-compatible script, generate the video using one of Crevita's custom avatars, add B-roll, get Crevita's approval, then publish to YouTube with accompanying LinkedIn and X/Twitter captions.

**Brand context:** YouTube videos are published under the "Crevita Moody" personal brand channel and the "How to Raise Your Robot" channel (Playhouse STEM). Determine which channel based on the content: AI safety, ethics, policy, and professional topics go to Crevita Moody. Children's content, parenting, and family AI topics go to How to Raise Your Robot.

---

## Prerequisites

- HeyGen account with API key (stored as `HEYGEN_API_KEY` environment variable)
- HeyGen plan awareness: check current plan tier and remaining Premium Credits before generating
- YouTube channel access for both channels
- Claude Code with Chrome browser automation capability for HeyGen web UI tasks
- Access to blog posts (Medium archive or draft files) as source material

---

## Crevita's HeyGen Avatars

These are Crevita's custom avatars, ranked by preference. Rotate usage across videos so the same avatar doesn't appear in consecutive uploads.

| Rank | Avatar ID | Notes |
|------|-----------|-------|
| 1 (favorite) | `176ef1975820485c865a5b7381d28866` | Primary avatar, use most frequently |
| 2 | `fc70a04e301d493d85ed9208a3065ba2` | Second choice |
| 3 | `d2e4bb73bc3e400397dc567418a1e25d` | Third choice |
| 4 | `fe23a1570823464c97e01f81c6d73d88` | Fourth choice |

**Rotation protocol:**
1. Before generating a new video, check the most recent YouTube upload on both channels
2. Note which avatar was used in the last 2 videos
3. Select a different avatar from the ranked list, prioritizing higher-ranked avatars that weren't recently used
4. If all 4 have been used in the last 4 videos, restart the rotation from #1

**Important:** The old `josh_lite3_20230714` avatar ID is invalid. Never use it.

---

## Script Writing

### Source Material

Scripts are typically derived from one of:
- A published or draft blog post (Medium/Substack)
- A topic brief or news item
- A research paper or report Crevita has covered

### Script Structure

**1. HOOK (8-15 seconds, 2-3 sentences max)**

Open with one technique that fits the content:
- **Shocking Statistic** -- surprising number challenging assumptions
- **Provocative Question** -- creates immediate curiosity
- **Bold Prediction** -- surprising yet inevitable future outcome
- **Common Misconception** -- "Most people believe X, but..."
- **Personal Stakes** -- connects topic to viewer's life
- **Contrast Hook** -- gap between perception and reality

**2. CREDIBILITY INTRO (Use verbatim -- do not modify):**

"Hi, I'm Crevita Moody's digital clone. Crevita is a data scientist, AI app developer, and best-selling author who has worked inside a Fortune 500 company and in government, specializing in AI research and real-world deployment. While this message is being delivered, she is focused on AI research and implementation strategies that will shape what happens next. Crevita personally researches every topic you hear, bringing clarity and judgment to a field moving at extraordinary speed."

**3. BRIDGE (1-2 sentences)**

Connect hook to content. Preview what viewer will learn. Example: "Today, we're breaking down [topic] and I'll show you exactly [outcome]."

**4. CORE CONTENT**

Transform source material following these rules:

*Simplification:*
- Replace jargon with everyday language
- Use daily-life analogies (cooking, driving, smartphones)
- Target 9th-grade reading level
- Always explain "so what" -- why it matters to them

*Engagement:*
- Address viewer as "you" frequently
- Use rhetorical questions
- Add brief examples and mini-stories
- Vary sentence length for rhythm
- Include one "golden nugget" insight they can share

*Structure:*
- 3-5 main points maximum
- Each builds on the previous
- Keep momentum -- no tangents

**5. SYNTHESIS (2-3 sentences)**

Connect all dots. Reinforce why this matters NOW. Make viewer feel smarter.

**6. CLOSE**

Memorable callback to hook. Natural CTA: subscribe + specific question for comments. Always end with:

"AI is moving fast, but we'll keep breaking it down. I'll see you in the next one."

### Script Formatting Rules (HeyGen-Compatible)

**DO:**
- Complete, flowing sentences
- Natural punctuation
- Contractions (I'm, you're, don't)
- Short paragraphs (2-4 sentences)
- "..." sparingly for emphasis

**DO NOT:**
- Timestamps or [B-roll]/[cut to] directions
- Bullet points or numbered lists
- Headers or section labels in the final script
- Emojis or special characters
- Stage directions like [pause] or [enthusiastically]
- Parenthetical notes
- Em dashes (use -- if needed, but prefer restructuring the sentence)

### Script Quality Check

Before submitting:
- [ ] Hook creates genuine curiosity?
- [ ] Credibility intro is verbatim (no modifications)?
- [ ] No unexplained jargon?
- [ ] A high schooler could follow the logic?
- [ ] Sounds natural when read aloud?
- [ ] HeyGen-compatible format (no directions, no bullets)?
- [ ] Word count: 800-1,500 words?
- [ ] No em dashes anywhere?

### Tone

Warm, authoritative, intellectually curious. Like explaining something fascinating to a smart friend who's new to the topic. Avoid academic stiffness, clickbait hype, and condescension.

---

## Video Generation

### Method Selection

Choose based on the complexity of the video:

**Option A: HeyGen API (Preferred for standard avatar videos)**

Use the Create Avatar Video V2 endpoint for straightforward talking-head videos:

```
POST https://api.heygen.com/v2/video/generate
Headers: X-API-KEY: {HEYGEN_API_KEY}
```

Or for Avatar IV quality (consumes Premium Credits):

```
POST https://api.heygen.com/v2/video/av4/generate
```

Required parameters: `avatar_id`, `voice_id`, `script`, `video_title`

Avatar IV supports `custom_motion_prompt` for gesture control and `enhance_custom_motion_prompt: true` for AI-refined motion.

**Option B: Video Agent (For videos with auto-generated B-roll and visuals)**

One-shot prompt-to-video generation:

```
POST https://api.heygen.com/v1/video_agent/generate
```

Video Agent automatically handles B-roll, motion graphics, and visual overlays that respond to the script content. Every element is editable in AI Studio after rendering.

**Option C: Browser Automation via Claude Code + Chrome**

For tasks requiring the AI Studio web UI (advanced B-roll editing, template customization, Emotional Intelligence Markers, or features not yet in the API):
1. Navigate to heygen.com and log in
2. Use AI Studio editor for script input
3. Select avatar from Crevita's custom avatars
4. Configure B-roll, transitions, and visual overlays
5. Use Voice Director for tone control if needed
6. Preview before rendering
7. Generate and download

### B-Roll Integration

HeyGen AI Studio supports built-in B-roll elements. Current capabilities (as of early 2026):

- **Generative B-roll** from Sora 2 and Veo 3.1 (Premium Credits required)
- **Stock content** from Getty (unlimited on paid plans)
- **Custom asset upload** -- logos, product screenshots, diagrams
- **Scene transitions** between segments
- **Text overlays** and motion graphics
- **Background music** from stock library

Video Agent mode automatically generates contextual B-roll that responds to the script content scene by scene. This is the recommended approach for most videos.

### Credit Awareness

Before generating any video, check Crevita's remaining Premium Credits:

| Feature | Credit Cost |
|---------|-------------|
| Avatar IV video | ~20 credits/minute |
| Video Agent (Full mode) | Premium Credits (varies) |
| Generative B-roll (Sora 2/Veo 3.1) | Premium Credits |
| Avatar III video | Unlimited (no credits) |
| Audio dubbing (no lip sync) | Unlimited |
| Stock content | Unlimited |

**Plan tiers (as of early 2026):**
- Creator ($29/mo): 200 Premium Credits/month (~10 min Avatar IV)
- Pro ($99/mo): 2,000 Premium Credits/month, 4K export, up to 30 min videos
- Business ($149/mo + $20/seat): 1,000 Premium Credits, up to 60 min videos, team workspace

**If credits are running low or a feature requires an upgrade:**
1. Do NOT proceed with generation
2. Send Crevita a message: "Your HeyGen account has [X] Premium Credits remaining. This video will use approximately [Y] credits. [Specific feature] requires [plan tier]. Want me to proceed, or should we adjust?"
3. Wait for approval before generating

Premium Credit add-on packs: $15/month for 300 additional credits, or $150/year for 3,600 credits.

Credits do NOT roll over -- unused credits expire at the end of each billing cycle.

---

## Latest HeyGen Features Awareness

Before each video generation, check for new HeyGen features by scanning:
1. https://docs.heygen.com/changelog (API updates)
2. https://www.heygen.com/blog (product releases)

**Current key features (early 2026):**
- **Avatar IV** -- micro-expressions, timing-aware hand gestures, natural blinks, emotion-aware body language
- **Video Agent 2.0** -- one-prompt-to-video pipeline with auto B-roll
- **Emotional Intelligence Markers** -- tag script sections with emotions (enthusiastic, empathetic, authoritative) for avatar expression matching
- **Voice Director** -- word/sentence-level tone control
- **Voice Mirroring** -- speech-to-speech for authentic delivery
- **Gesture Control** -- map specific gestures to script moments
- **LiveAvatar** -- real-time interactive avatars (replacing Interactive Avatar, which sunsets March 31, 2026)
- **Brand System** -- visual identity consistency across videos
- **Sora 2 / Veo 3.1 B-roll** -- generative cinematic B-roll (Premium)
- **15-second avatar creation** -- webcam-based (for new avatars if needed)
- **SCORM export** -- for training content (Business+ plans)

If a new feature would improve the current video, flag it for Crevita's approval before using.

---

## Review and Approval

**Nothing gets published without Crevita's explicit approval.**

### Pre-Generation Review

Before generating the video, send Crevita:
1. The complete script
2. Which avatar will be used (and why, based on rotation)
3. Estimated credit consumption
4. Recommended B-roll approach (Video Agent auto, manual, or stock-only)

Wait for script approval before generating.

### Post-Generation Review

Once the video is rendered:
1. Send Crevita the video preview link from HeyGen
2. Include a note on: avatar quality, lip-sync accuracy, B-roll relevance, any issues spotted
3. Wait for approval, revision requests, or rejection

If Crevita requests changes:
- Minor script edits can be made in AI Studio without full re-render
- Avatar or B-roll changes require re-generation
- Re-check credit availability before re-rendering

---

## YouTube Publishing

After video approval, prepare for YouTube upload:

### Video Metadata

- **Title:** Use Hook Point techniques -- curiosity gap, pattern interrupt, or data-forward. Keep under 60 characters for full display
- **Description:** First 2 lines are visible before "Show More". Include the hook, then a brief summary, relevant links, and timestamps if applicable
- **Tags:** 8-12 relevant tags mixing broad (AI, artificial intelligence) and specific (topic-related)
- **Thumbnail:** See the YouTube Thumbnail skill (when available). Until then, flag that a thumbnail is needed
- **Category:** Science & Technology (typically)
- **End screen:** Add subscribe button and related video suggestion

### Channel Selection

- **Crevita Moody channel:** AI safety, ethics, policy, professional AI topics, research breakdowns
- **How to Raise Your Robot channel:** Children's content, parenting AI guides, family-friendly AI education

---

## Social Distribution

After YouTube upload, prepare distribution assets:

### LinkedIn Caption

Draft using the blog publishing skill guidelines:
- 4 lines max
- Curiosity-gap approach (withhold the payoff to drive clicks)
- End with CTA to the YouTube link
- Include #Crevita hashtag
- No em dashes

### X/Twitter Post

Draft using the `twitter-posting` SKILL.md guidelines:
- 280 character limit (URLs count as 23 characters)
- Hook Point techniques
- Source link included
- No em dashes
- See `references/voice-and-hooks.md` from the twitter-posting skill for voice guidelines

### Approval Gate

Send Crevita all distribution drafts together:
```
VIDEO PUBLISHED: [YouTube link]

LinkedIn caption:
[draft]

X/Twitter post:
[draft]

Approve all, or let me know what to change.
```

Do not post to LinkedIn or X without explicit approval.

---

## Error Handling

- **API returns error:** Log the error, check if it's a credit/plan issue, and notify Crevita with the specific error message and recommended action
- **Video generation fails:** Check if the script exceeds the 5,000 character limit per text input. If so, split into scenes. Notify Crevita that a re-render is needed
- **Avatar ID not found:** Verify against the avatar table above. If an avatar has been deleted or changed, use the List All Avatars V2 API to get current IDs and update the table
- **Credit insufficient:** Do not attempt generation. Notify Crevita with current balance, estimated cost, and options (use Avatar III instead, purchase credit pack, wait for cycle reset)
- **HeyGen platform down:** Queue the approved script and retry every 30 minutes for 4 hours. If still down, notify Crevita
- **Video quality issues (lip sync, artifacts, glitches):** Flag specific timestamps in the review message so Crevita can evaluate whether to re-render or accept
- **Failed renders may still consume credits:** Note this risk when reporting failures

---

## Workflow Summary

1. Receive blog post or topic brief
2. Write HeyGen-compatible script following the structure above
3. Check avatar rotation -- select next avatar
4. Check HeyGen credits and plan capacity
5. Check for latest HeyGen features that could enhance the video
6. Send script + avatar choice + credit estimate to Crevita for approval
7. On approval, generate video (API or browser automation)
8. Send video preview link to Crevita for review
9. On approval, upload to appropriate YouTube channel
10. Draft LinkedIn caption and X/Twitter post
11. Send distribution drafts to Crevita for approval
12. On approval, post to LinkedIn and X/Twitter
13. Confirm all posts with live links

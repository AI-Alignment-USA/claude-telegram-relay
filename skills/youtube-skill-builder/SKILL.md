---
name: youtube-skill-builder
description: >
  Research YouTube content and build AI agent skill files from video transcripts. This is a
  meta-skill: it creates OTHER skills by deeply studying YouTube videos on a given topic.
  Use this skill whenever Crevita asks to: "build a skill from YouTube", "research YouTube
  for a topic and make a skill", "create a skill about X", "study [person/channel] and make
  a skill", "learn from YouTube videos about X", "make a skill from transcripts",
  "extract knowledge from YouTube", "I want an agent that knows about X -- go study it",
  or any request that involves pulling knowledge from YouTube videos and packaging it into a
  reusable skill file for Tamille agents or Claude. Also trigger when she says things like
  "go learn about X from YouTube", "study [expert name]", "become an expert on X by watching
  videos", "research [topic] from credible sources on YouTube", or "make my agents smarter
  about X". This skill handles the entire pipeline: finding videos, downloading transcripts,
  analyzing content, and producing a properly formatted SKILL.md file with references.
---

# YouTube Skill Builder

## What This Skill Does

This skill turns YouTube into a research library. Given a topic, expert, or channel, it:
1. Finds the most relevant and credible videos
2. Downloads transcripts (never video/audio files)
3. Analyzes transcripts to extract frameworks, principles, and actionable knowledge
4. Packages everything into a properly formatted skill file for Tamille agents or Claude

The output is a production-ready skill that makes an AI agent deeply knowledgeable about the researched topic.

---

## Prerequisites

Before starting, verify yt-dlp is installed:
```bash
# On Windows (Crevita's setup)
py -m pip install yt-dlp
py -m yt_dlp --version

# On Linux/Mac
pip install yt-dlp
yt-dlp --version
```

If Python is not available, yt-dlp can also be installed standalone: https://github.com/yt-dlp/yt-dlp

---

## PHASE 1: UNDERSTAND THE REQUEST

Before touching YouTube, clarify what Crevita needs. There are two research modes:

### Mode A: Known Expert / Channel
Crevita knows WHO to study. Examples:
- "Build a skill from Russell Brunson's content"
- "Study Caleb Ralston's YouTube and make a brand skill"
- "Research Alex Hormozi's videos on offers"

**What to ask/confirm:**
- Which channel(s) or expert(s)?
- Any specific videos she already knows are good?
- What should the skill DO when an agent uses it? (e.g., "think like Brunson when building funnels")
- Any topics within that expert's work to prioritize or skip?
- **Time frame?** How recent should the content be? Parse her input carefully:
  - Strict cutoff: "no more than 3 months old" = ONLY videos uploaded within the last 3 months. Do NOT include older content.
  - Recency bias: "prioritize recent" or "focus on 2025" = prefer recent but allow older cornerstone content
  - No preference stated: default to recency bias (last 12 months weighted heavily, older allowed)
  - Always confirm if unclear: "Do you want ONLY videos from the last 3 months, or should I also include older foundational content?"

### Mode B: Topic Research (No Specific Expert)
Crevita wants knowledge on a TOPIC. Examples:
- "Build a skill about email marketing"
- "I need my agents to understand SEO"
- "Research how to price digital products"

**What to ask/confirm:**
- What is the specific topic?
- Any known credible voices she trusts on this topic?
- What should the skill enable an agent to DO? (strategy? implementation? both?)
- Any angle or context? (e.g., "for small creators" vs "for enterprise")
- **Time frame?** Same rules as Mode A:
  - Strict cutoff: "no more than 6 months old" = hard filter, reject anything older
  - Recency bias: "recent stuff" = prefer recent but allow older if foundational
  - No preference: default to recency bias (last 12 months weighted, older allowed)
  - For fast-moving topics (AI, social media algorithms, platform features): suggest strict cutoff of 6-12 months
  - For evergreen topics (copywriting fundamentals, persuasion psychology): recency bias is fine

### For Both Modes: Personalization Context

Every skill built should be personalized to Crevita's situation. Confirm which context applies:
- **Playhouse STEM** (playhousestem.ai): Children's content, parenting/AI advice, family products, Gumroad digital products
- **Crevita Moody professional brand**: IT/AI consulting, security frameworks, automation, technical products, thought leadership
- **Both**: Some skills apply to both brands

Never mix the two brands unless she explicitly says to.

---

## PHASE 2: FIND VIDEOS

### Step 2a: Set Up the Research Directory

```bash
SKILL_NAME="topic-name"  # e.g., "funnel-mastery", "seo-strategy"
mkdir -p ~/skills-research/$SKILL_NAME/transcripts
mkdir -p ~/skills-research/$SKILL_NAME/analysis
mkdir -p ~/skills-research/$SKILL_NAME/output/references
```

### Step 2b: Calculate the Date Filter

Before searching, convert Crevita's time frame into a yt-dlp date filter. yt-dlp uses `--dateafter YYYYMMDD` to enforce date cutoffs.

```bash
# Calculate the cutoff date based on her request
# "no more than 3 months old" from today (March 24, 2026) = 20251224
# "last 6 months" = 20250924
# "last 12 months" = 20250324
# "2025 only" = 20250101

# On Windows (PowerShell-compatible):
py -c "from datetime import datetime, timedelta; print((datetime.now() - timedelta(days=90)).strftime('%Y%m%d'))"

# Store the cutoff date as a variable
CUTOFF_DATE="20251224"  # Replace with calculated date
```

**Time frame translation cheat sheet:**
| User Says | Days Back | Example Cutoff (from 2026-03-24) |
|-----------|-----------|----------------------------------|
| "no more than 1 month old" | 30 | 20260224 |
| "no more than 3 months old" | 90 | 20251224 |
| "no more than 6 months old" | 180 | 20250924 |
| "last year" / "12 months" | 365 | 20250324 |
| "2025 and 2026 only" | -- | 20250101 |
| "no preference" | -- | No filter (but weight recent higher in selection) |

### Step 2c: Search for Videos

Use multiple search strategies. **Apply `--dateafter $CUTOFF_DATE` to ALL searches when a strict time frame is set.**

**For Known Expert/Channel:**
```bash
# List videos from their channel -- WITH date filter
py -m yt_dlp --flat-playlist --dateafter $CUTOFF_DATE \
  --print "%(id)s | %(title)s | %(upload_date)s | %(view_count)s" \
  "https://www.youtube.com/@ChannelHandle/videos" 2>/dev/null | head -50

# If --dateafter doesn't work with --flat-playlist (some versions), fetch all and filter manually:
py -m yt_dlp --flat-playlist \
  --print "%(id)s | %(title)s | %(upload_date)s | %(view_count)s" \
  "https://www.youtube.com/@ChannelHandle/videos" 2>/dev/null | head -100 > all_videos.txt

# Then filter by date (upload_date field is YYYYMMDD):
awk -F' \\| ' -v cutoff="$CUTOFF_DATE" '$3 >= cutoff || $3 == "NA"' all_videos.txt > filtered_videos.txt
# Note: "NA" dates are common in flat-playlist mode -- keep them and verify individually

# Search for their key topics
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s" \
  "ytsearch20:Expert Name topic keyword" 2>/dev/null

# CRITICAL: Search for guest appearances on OTHER channels
# This is where experts often go deepest -- hosts pull out insights they don't share on their own channel
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s" \
  "ytsearch15:Expert Name interview" 2>/dev/null
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s" \
  "ytsearch15:Expert Name podcast" 2>/dev/null
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s" \
  "ytsearch10:Expert Name on" 2>/dev/null
```

**For Topic Research (No Specific Expert):**
```bash
# Include the year/timeframe in the search query itself for better results
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s | %(view_count)s" \
  "ytsearch30:topic keyword phrase 2026" 2>/dev/null

# Search with variations
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s" \
  "ytsearch20:topic keyword framework strategy 2025" 2>/dev/null
py -m yt_dlp --flat-playlist --print "%(id)s | %(title)s | %(upload_date)s" \
  "ytsearch20:topic keyword tutorial how to 2026" 2>/dev/null
```

**IMPORTANT: When yt-dlp search returns "NA" for upload_date (common with ytsearch), you MUST verify the date before downloading the transcript:**
```bash
# Get the actual upload date for a single video
py -m yt_dlp --print "%(upload_date)s" "https://www.youtube.com/watch?v=VIDEO_ID" 2>/dev/null
```

**If a strict time frame is set, REJECT any video that falls outside it.** Do not include it even if it looks highly relevant. The user explicitly asked for a time boundary -- respect it. If this leaves too few results, report back to Crevita: "I only found 6 videos within your 3-month window. Want me to expand to 6 months?"

### Step 2d: Select Videos to Transcribe

From the search results, select **15-30 videos** using these criteria:

**FIRST: Apply the date filter.**
- If Crevita gave a strict cutoff ("no more than 3 months old"), DISCARD any video outside that window. No exceptions, no matter how relevant it looks.
- If she gave a recency bias ("prioritize recent"), keep everything but rank recent videos higher.
- If no preference, default to recency bias.

**THEN: Rank by priority (highest to lowest):**
1. Recent content within the specified time frame
2. Cornerstone/flagship content (long-form courses, masterclasses, comprehensive training) -- only if within date range or no strict cutoff
3. High view count videos on the core topic
4. Guest interviews and podcast appearances on other channels
5. Older foundational content -- ONLY if no strict cutoff was set

**If strict date filter leaves fewer than 10 videos:**
Report to Crevita with the count and ask whether to expand the window. Example: "I found 7 videos about selling digital products within the last 3 months. Want me to expand to 6 months, or should I work with these 7?"

**Credibility filters:**
- Prefer practitioners over commentators (people who DO the thing, not just talk about it)
- Prefer channels with established audiences over random uploads
- For topic research, look for consensus across multiple credible sources
- Skip obvious clickbait, AI-generated summary channels, and low-effort content

**Quantity targets:**
- Known Expert mode: 20-30 videos (channel content + guest appearances)
- Topic Research mode: 15-25 videos across 3-5 credible voices

---

## PHASE 3: DOWNLOAD TRANSCRIPTS

Download ONLY subtitles/transcripts. Never download video or audio files.

```bash
cd ~/skills-research/$SKILL_NAME/transcripts

# For each selected video ID:
py -m yt_dlp --write-auto-sub --sub-lang en --skip-download \
  --output "%(id)s_%(title)s" \
  "https://www.youtube.com/watch?v=VIDEO_ID" 2>/dev/null

# If auto-subs unavailable, try manual subs:
py -m yt_dlp --write-sub --sub-lang en --skip-download \
  --output "%(id)s_%(title)s" \
  "https://www.youtube.com/watch?v=VIDEO_ID" 2>/dev/null
```

**Batch download pattern** (more efficient):
```bash
# Create a file with video IDs, one per line
cat > video_ids.txt << 'EOF'
VIDEO_ID_1
VIDEO_ID_2
VIDEO_ID_3
EOF

# Download all transcripts
while read vid; do
  py -m yt_dlp --write-auto-sub --sub-lang en --skip-download \
    --output "%(id)s_%(title)s" \
    "https://www.youtube.com/watch?v=$vid" 2>/dev/null
  sleep 1  # Rate limit protection
done < video_ids.txt
```

**Convert VTT to clean text:**
```bash
for f in *.vtt; do
  # Strip VTT formatting, timestamps, and deduplicate lines
  sed '/^$/d; /^[0-9]/d; /-->/d; /^NOTE/d; /^WEBVTT/d; /^Kind:/d; /^Language:/d' "$f" \
    | awk '!seen[$0]++' > "${f%.vtt}.txt"
done

# Verify -- list all text files with sizes
ls -lhS *.txt
```

**Troubleshooting:**
- If a video has no subtitles at all, note it in the research log and skip it
- If rate-limited, wait 30 seconds between downloads
- Very long videos (3+ hours) produce large transcript files -- this is expected and good
- Check that .txt files are not empty: `wc -l *.txt | sort -n | head`

---

## PHASE 4: ANALYZE TRANSCRIPTS

This is the most important phase. Read every transcript and extract structured knowledge.

### What to Extract

For each transcript, pull out:

1. **Named frameworks** -- Any structured process with a name (e.g., "Value Ladder", "Brand Journey Framework", "The Accordion Method"). Get the exact name, all steps, and the expert's own explanation.

2. **Key principles** -- Core beliefs and rules the expert teaches repeatedly. Note when multiple videos reinforce the same principle.

3. **Exact quotes** -- Memorable one-liners, definitions, and soundbites that capture a concept perfectly. These go into the skill file as blockquotes.

4. **Real examples and case studies** -- Specific stories, numbers, and results the expert shares. These make the skill actionable, not theoretical.

5. **Contrarian or unique takes** -- Where does this expert disagree with conventional wisdom? These are often the most valuable insights.

6. **Tactical how-tos** -- Step-by-step instructions, templates, scripts, and specific techniques.

7. **Evolution over time** -- Has the expert updated or changed their advice in recent videos vs. older ones? Always prefer the latest version.

### Analysis Strategy

**If you have subagents (Claude Code):**
Split transcripts into batches of 4-6 and analyze in parallel. Each agent writes findings to `~/skills-research/$SKILL_NAME/analysis/batch_N.md`.

**If working sequentially:**
Read transcripts in order of importance (recent first). Focus on frameworks and unique insights -- skip small talk and filler.

For the analysis output format and template, read `references/skill-template.md` -- the "Research Log Template" section includes the structure.

---

## PHASE 5: BUILD THE SKILL FILE

### Skill File Requirements

Read `references/skill-template.md` for the exact template. Key requirements:

1. **YAML frontmatter** with `name` and `description` (description is the trigger mechanism -- make it comprehensive and slightly "pushy" so agents actually use it)

2. **Under 500 lines** for the main SKILL.md. If more depth is needed, create reference files in a `references/` subdirectory.

3. **Personalized to Crevita's context** -- Include sections mapping frameworks to her actual situation (Playhouse STEM, Gumroad products, two-brand strategy, etc.)

4. **Actionable, not theoretical** -- An agent reading this skill should be able to IMPLEMENT the advice. Include decision trees, templates, and "when to use what" guidance.

5. **Source attribution** -- Note which video/expert a framework came from. This helps Crevita trace back to the source if she wants to go deeper.

6. **AI-era updates** -- Include a section on how the topic applies in 2025-2026 with AI tools available. This is especially important since AI is changing every field.

7. **Recency bias** -- When older and newer content conflict, use the newer version. Note the evolution.

8. **Cross-references** -- If the new skill relates to existing skills (funnel-mastery, personal-brand-mastery, twitter-posting, gumroad-publishing), include an integration section.

### Skill File Structure

For the complete skill file template with all sections, read `references/skill-template.md`. Key sections: Core Philosophy, Frameworks (with quotes from transcripts), Applying to Crevita's Context, AI-Era Adaptations, Quick-Reference Decision Trees, Integration With Other Skills.

### Writing the Description Field

The description is the MOST IMPORTANT part -- it determines whether agents actually trigger the skill. Follow these rules:

- List every possible phrase or keyword a user might say that should trigger this skill
- Include both formal terms ("conversion optimization") and casual language ("nobody is buying my stuff")
- Include question patterns ("how do I...", "why isn't my...")
- Be slightly redundant -- better to over-trigger than under-trigger
- Keep it under ~150 words but pack it dense

---

## PHASE 6: CREATE THE RESEARCH LOG

Every skill build should produce a research log documenting the full research trail:

```markdown
# Research Log -- [Skill Name]

**Date:** [date]
**Topic:** [what was researched]
**Mode:** [Known Expert / Topic Research]
**Time Frame Requested:** [exact user input, e.g., "no more than 3 months old"]
**Time Frame Applied:** [Strict cutoff: YYYYMMDD / Recency bias / No filter]
**Cutoff Date Used:** [YYYYMMDD or "none"]
**Videos Transcribed:** [count]
**Videos Rejected (outside date range):** [count, if strict filter was used]
**Experts Covered:** [names]

## Videos Transcribed
| # | Video ID | Title | Upload Date | Channel | Key Frameworks Found |
|---|----------|-------|-------------|---------|---------------------|
| 1 | [id] | [title] | [YYYYMMDD] | [channel] | [frameworks] |

## Videos Rejected (Date Filter)
| # | Video ID | Title | Upload Date | Why It Looked Relevant |
|---|----------|-------|-------------|----------------------|
| 1 | [id] | [title] | [date] | [brief note] |

(This section helps Crevita decide if she wants to expand the time window later.)

## Framework Inventory
| Framework | Source Video(s) | Status |
|-----------|----------------|--------|
| [name] | [video IDs] | Found / Partial / Not Found |

## Gaps & Missing Content
[What was expected but not found in transcripts within the time frame]

## Notes
[Any other observations about the research]
```

---

## PHASE 7: DELIVER AND INSTALL

### Output Directory Structure
```
~/skills-research/$SKILL_NAME/output/
  ├── SKILL.md              (main skill file, <500 lines)
  ├── references/            (deep-dive files if needed)
  │   ├── [topic-1].md
  │   └── [topic-2].md
  └── research-log.md       (full source documentation)
```

### Delivery Checklist
- [ ] SKILL.md is under 500 lines
- [ ] Description field is comprehensive and trigger-happy
- [ ] Frameworks are sourced from actual transcripts, not secondary summaries
- [ ] **Time frame was respected** -- if strict cutoff was set, NO videos outside the window were used
- [ ] **Research log documents the time frame** -- requested range, applied filter, and any rejected videos
- [ ] Personalized to Crevita's context (correct brand applied)
- [ ] AI-era section included
- [ ] Cross-references to existing skills included
- [ ] Research log documents all sources with upload dates
- [ ] Commit and push to GitHub

### Installing the Skill

For Tamille agents: Copy the skill directory to wherever Tamille agents read skill files from. The agent needs access to both SKILL.md and any reference files.

For Claude (claude.ai): The skill can be uploaded as a .skill file or the SKILL.md can be pasted into a project's custom instructions.

---

## QUICK START EXAMPLES

### Example 1: Known Expert
**User says:** "Study Alex Hormozi's YouTube and build a skill about creating irresistible offers"

**Action:**
1. Search @AlexHormozi channel + "Alex Hormozi interview" + "Alex Hormozi offer"
2. No strict time frame given -- apply recency bias (weight last 12 months, allow older)
3. Download 20-25 transcripts (channel + guest appearances)
4. Focus on: $100M Offers framework, value equation, grand slam offers
5. Build `irresistible-offers/SKILL.md` personalized to Crevita's Gumroad products

### Example 2: Topic Research WITH Strict Time Frame
**User says:** "I want transcripts for YouTube videos about selling digital products. Videos should be no more than 3 months old."

**Action:**
1. Calculate cutoff: 3 months back from today = YYYYMMDD
2. Search "selling digital products 2026", "digital product sales strategy", "Gumroad sales"
3. Apply `--dateafter CUTOFF` to all searches. Verify upload dates for any "NA" results.
4. **REJECT any video outside the 3-month window** even if it looks great
5. If fewer than 10 videos pass the filter, report back: "Only found 8 videos within 3 months. Expand to 6 months?"
6. Download transcripts ONLY for videos that pass the date filter
7. Identify the 3-5 most credible voices from the filtered results
8. Build `digital-product-sales/SKILL.md` reflecting ONLY current advice (no older content)
9. Research log documents: time frame requested, cutoff date used, videos rejected with dates

### Example 3: Topic Research (No Time Constraint)
**User says:** "I need a skill about YouTube SEO -- find the best people teaching it"

**Action:**
1. No time frame specified -- default to recency bias
2. Search "YouTube SEO strategy 2025 2026", "YouTube algorithm", "YouTube growth"
3. Identify 3-5 credible voices from results (look for practitioners with results)
4. Download 15-20 transcripts across those voices, weighting recent content
5. Build `youtube-seo/SKILL.md` synthesizing the best advice from all sources

### Example 4: Narrow Expert + Topic
**User says:** "Study Pat Flynn's content about passive income with digital products"

**Action:**
1. Search @PatFlynn channel for digital product content
2. No time frame specified -- default to recency bias
3. Search "Pat Flynn passive income interview" for guest appearances
4. Download 15-20 transcripts focused on digital products specifically
5. Build `passive-income-products/SKILL.md` mapped to Crevita's Gumroad strategy

---

## IMPORTANT RULES

1. **NEVER download video or audio files.** Transcripts/subtitles only. This keeps things fast and lightweight.

2. **Always search for guest appearances.** Channel content alone misses critical insights. Interviews on other channels are often where experts go deepest.

3. **Respect the time frame.** When Crevita gives a strict cutoff ("no more than X months old"), it is a HARD FILTER. Do not include older videos no matter how relevant they look. If the filter is too restrictive, ask her to expand it -- do not silently ignore it.

4. **Credibility over views.** A 10K-view video from someone who actually does the thing beats a 1M-view video from someone who just talks about it.

5. **The description field makes or breaks a skill.** Spend real time on it. If the trigger description is weak, agents will never use the skill.

6. **Always personalize to Crevita.** Every skill should map to her real products, platforms, and two-brand strategy. Generic advice is useless.

7. **Commit and push to GitHub after every skill build.** She forgets this step -- remind her.

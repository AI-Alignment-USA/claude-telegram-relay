---
name: skillmd-maker
description: >
  Generate production-ready SKILL.md files from plain-language descriptions. Use this skill whenever
  the user asks to "make a skill", "create a SKILL.md", "build a skill for [agent]", "I need a skill
  that does X", "write instructions for [agent] to do Y", or any request to codify a workflow, SOP,
  or capability into a portable skill file. Also trigger when the user says "turn this into a skill",
  "make this repeatable", "teach the agent how to do this", or provides a system prompt and memory
  block and wants it converted into a SKILL.md. This skill researches the topic when needed, structures
  the output in proper SKILL.md format with YAML frontmatter, and tailors the result to the Tamille
  Agent ecosystem. Trigger on: "skill", "SKILL.md", "make a skill", "skill file", "teach the agent",
  "agent instructions", "SOP to skill", "workflow skill", or any reference to creating reusable
  agent instructions.
---

# Skill.md Maker

## Purpose

This skill turns a plain-language description of what an agent needs to do into a complete, production-ready SKILL.md file. It handles the full pipeline: understanding the request, researching the topic for current best practices and API details, structuring the skill, and delivering a file that any Tamille Agent can pick up and execute.

## When to Research

Before writing any skill, determine if the topic requires current information:

- **API integrations** (HeyGen, YouTube, Medium, Substack, platform analytics, etc.) -- ALWAYS research. APIs change constantly. Fetch current docs, endpoints, rate limits, and authentication methods.
- **Tool/platform workflows** (Canva, PM2, Claude Code, browser automation, etc.) -- ALWAYS research for the latest features, CLI flags, known issues, and best practices.
- **Established methodologies** (BIFF communication, content writing structures, co-parenting frameworks) -- Research is optional. These are stable. Focus on structuring the existing knowledge clearly.
- **Hybrid topics** (video production with AI tools, social media publishing) -- Research the technical integration points, skip the general strategy.

Use `web_search` and `web_fetch` to gather current documentation. Prioritize official docs, API references, and changelogs over blog posts and tutorials.

---

## Output Format

Every SKILL.md follows this structure:

```markdown
---
name: skill-name-here
description: >
  [Pushy, comprehensive trigger description. Include what the skill does,
  when to use it, specific trigger phrases, and edge cases where it should
  still fire. Err on the side of over-triggering.]
---

# [Skill Title]

## Overview
[2-3 sentences: what this skill does, who uses it, what the deliverable is]

## Prerequisites
[API keys, tools, accounts, file paths, or dependencies needed]

## Workflow
[Step-by-step process the agent follows. Use numbered steps for sequential
work, headers for parallel tracks.]

## Output Format
[What the agent produces: message format, file type, approval gates, etc.]

## Voice / Style Guidelines
[If the skill produces content: tone, reading level, formatting rules,
brand constraints. If not content-facing, skip this section.]

## Error Handling
[What to do when things break: API failures, missing data, timeouts,
credential issues. Always include a "notify Crevita" fallback.]

## Platform-Specific Notes
[Current API quirks, rate limits, known issues, feature flags.
This section is the most research-dependent.]
```

### Format Rules

1. **YAML frontmatter is mandatory.** `name` and `description` fields required.
2. **Description must be pushy.** The skill-creator docs say it best: Claude tends to "undertrigger" skills. Write descriptions that cast a wide net. Include trigger phrases, synonyms, and edge cases.
3. **No em dashes anywhere.** Use double hyphens (--) instead. This is a hard rule across all Crevita content.
4. **Explain the why, not just the what.** Instead of "ALWAYS do X", explain why X matters so the agent can adapt intelligently.
5. **Keep SKILL.md under 500 lines.** If longer, split into a main SKILL.md with references/ directory for detailed docs.
6. **Include approval gates.** For any skill that produces external-facing output (posts, videos, emails, messages), include an explicit approval step before publishing.
7. **Include error handling.** Every skill needs a section on what happens when things go wrong.
8. **Brand separation awareness.** If the skill touches public content, specify whether it falls under Playhouse STEM (children's/parenting content) or Crevita Moody personal brand (professional IT/AI consulting). Never mix the two.

---

## Process

### Step 1: Intake

When the user describes what they need, extract:

1. **What agent will use this skill?** (CMO, COO, CIO, CISO, Head of Education, etc.)
2. **What is the deliverable?** (Post, report, video, message, analysis, etc.)
3. **What platforms or tools are involved?** (HeyGen, YouTube, Medium, X, Canva, etc.)
4. **Is there an existing SOP, system prompt, or memory block to convert?** If yes, use it as the foundation.
5. **Does it need an approval gate?** (Default: yes for anything external-facing)
6. **What schedule or trigger launches this?** (Scheduled cron, /command, on-demand, etc.)

If the user's description is thin, ask for clarification. But if they've given you a detailed brief (like a system prompt + memory block), don't over-interview. Draft first, refine after.

### Step 2: Research (if needed)

For topics requiring current info:

1. Search for official API documentation, SDKs, and developer guides
2. Search for recent changelogs, breaking changes, or deprecations
3. Search for known issues, workarounds, and community best practices
4. Search for rate limits, pricing tiers, and plan-specific feature gates

Synthesize findings into the Platform-Specific Notes section of the skill.

### Step 3: Draft the SKILL.md

Write the complete skill following the output format above. Key considerations:

- **Progressive disclosure**: Keep the main SKILL.md focused. If a section (like API endpoint details or voice guidelines) exceeds 50 lines, move it to a `references/` file and point to it from the main SKILL.md.
- **Concrete examples**: Include at least one example of expected input/output or message format wherever the agent produces content.
- **Context for the agent**: Include enough background that an agent reading this skill cold (no conversation history) can execute it correctly.
- **File paths**: Use the Tamille Agent ecosystem paths where relevant (e.g., supporting documents in OneDrive, skill files in the repo).

### Step 4: Present and Iterate

1. Present the draft SKILL.md to Crevita
2. Ask: "Does this capture the workflow? Anything to add, change, or cut?"
3. Revise based on feedback
4. Deliver the final SKILL.md file (and any references/ files) for placement in the skills repo

---

## Converting Existing Agent Configs to Skills

When the user provides a system prompt + memory block from an existing agent:

1. **Extract the workflow** from the system prompt. This becomes the Workflow section.
2. **Extract preferences and principles** from the memory block. These become Voice/Style Guidelines and Key Principles sections.
3. **Extract tool/resource references** from both. These become Prerequisites and Platform-Specific Notes.
4. **Identify what's missing.** Existing agent configs often lack error handling, approval gates, and edge case coverage. Add these.
5. **Don't lose nuance.** Memory blocks contain hard-won learnings (like "don't reference custody agreement specifics unnecessarily" or "lead with positive information"). These are the most valuable parts. Preserve them prominently.

---

## Quality Checklist

Before delivering any SKILL.md, verify:

- [ ] YAML frontmatter has `name` and `description`
- [ ] Description is pushy with multiple trigger phrases
- [ ] No em dashes (-- used instead)
- [ ] Under 500 lines (or properly split with references/)
- [ ] Approval gate included for external-facing output
- [ ] Error handling section present
- [ ] Brand separation respected (Playhouse STEM vs. Crevita Moody)
- [ ] File paths and platform details are current (researched if needed)
- [ ] At least one concrete example of expected output
- [ ] Agent can execute this cold with no prior conversation context

---

## Skill Inventory Awareness

When creating a new skill, check if related skills already exist to avoid duplication and ensure cross-referencing:

**Known existing skills in the ecosystem:**
- `twitter-posting` -- X/Twitter content creation with Hook Point techniques
- `gumroad-publishing` -- Gumroad product page and storefront management
- Blog/Medium writing -- SOP exists but not yet converted to SKILL.md format

When a new skill references or depends on another skill, include a note:
```
**Related skills:** See `twitter-posting` SKILL.md for X/Twitter voice guidelines
and Hook Point framework. This skill handles [different scope] and should
cross-reference rather than duplicate those guidelines.
```

---

## Example: Converting a System Prompt to SKILL.md

**Input from user:**
> "Here's my blog agent's system prompt and memory. Turn it into a skill."

**Process:**
1. Read the system prompt for the content structure (What Was Discovered, Why This Matters, Reality Check, What Needs to Happen, The Bottom Line)
2. Read the memory for editorial principles (8th grade reading level, balance over alarm, COI disclosures, stakeholder specificity)
3. Read the tools section for technical requirements (docx library, web_fetch, web_search)
4. Add what's missing: error handling for failed research fetches, approval gate before publishing, placeholder URL management
5. Output a complete SKILL.md with all sections

**The skill file should be immediately usable by any agent that reads it -- no additional context needed.**

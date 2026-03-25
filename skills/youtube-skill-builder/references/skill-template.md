# Skill File Template

Use this template when building a new skill from YouTube transcript research. Copy this structure and fill in each section.

---

## YAML Frontmatter (Required)

```yaml
---
name: [kebab-case-name]
description: >
  [What the skill does in one sentence]. Use this skill whenever the user asks about
  [topic area 1], [topic area 2], or [topic area 3]. Also trigger when the user mentions:
  "[keyword 1]", "[keyword 2]", "[keyword 3]", "[casual phrase 1]", "[casual phrase 2]",
  "[question pattern 1]", "[question pattern 2]", or any reference to [broader category].
  [One sentence about the skill's perspective/approach -- e.g., "This skill thinks like
  Russell Brunson -- it sees every business problem as a funnel problem."]
---
```

**Description writing rules:**
- Pack in every trigger keyword and phrase you can think of
- Include formal terms AND casual language
- Include question patterns ("how do I...", "why isn't...")
- Include problem statements ("nobody is buying", "my content isn't working")
- Be slightly pushy -- better to over-trigger than miss
- Stay under ~150 words

---

## Main Body Structure

```markdown
# [Skill Title]

## Core Philosophy

[2-3 paragraphs that establish the foundational worldview of this skill. What does this
expert/topic believe about the world? What is the central insight that everything else
builds on? Include a powerful quote from the transcript.]

> "[Exact quote from transcript that captures the philosophy]" -- [Expert Name]

---

## [FRAMEWORK 1 NAME] (Start Here)

[Mark the most foundational framework as the starting point. This is what an agent
should apply FIRST before anything else.]

### [Step/Component 1]
[Explanation with the expert's own language]

### [Step/Component 2]
[...]

### Applying This Framework
[Specific guidance for how to USE this -- not just understand it]

---

## [FRAMEWORK 2 NAME]

[Next most important framework. Include:]
- The expert's exact name for it
- All steps or components
- At least one real example or case study from the transcripts
- A blockquote with the expert's own words

> "[Exact quote]" -- [Expert Name] ([Video title or context])

---

## [FRAMEWORK 3+ NAME]

[Continue with remaining frameworks, ordered by importance]

---

## APPLYING TO CREVITA'S CONTEXT

[This section is REQUIRED in every skill. Map the frameworks to her actual situation.]

### For Playhouse STEM (if applicable)
- [Specific application to children's content, parenting/AI, Gumroad products]
- [Specific product examples: "How to Put Your Robot to Sleep", Parent's Activity Checklist, etc.]

### For Professional Brand (if applicable)
- [Specific application to IT/AI consulting, thought leadership, speaking]

### Immediate Action Items
1. [First thing she should do based on this skill]
2. [Second thing]
3. [Third thing]

---

## AI-ERA ADAPTATIONS (2025-2026)

[How has AI changed this topic? What still works? What's different?]

- [Adaptation 1]
- [Adaptation 2]
- [What AI tools can help with this topic]
- [What AI CANNOT replace -- the human element]

---

## QUICK-REFERENCE DECISION TREES

### "[Common question an agent would face]"
1. [Decision point 1] -- if yes, do X; if no, do Y
2. [Decision point 2] -- ...
3. [Decision point 3] -- ...

### "[Another common question]"
1. ...

---

## INTEGRATION WITH OTHER SKILLS

[How does this skill work with existing skills? Reference by name.]

| This Skill Handles | [Other Skill] Handles |
|---|---|
| [responsibility] | [responsibility] |
| [responsibility] | [responsibility] |

---
```

## Reference Files (When Needed)

If the main SKILL.md approaches 500 lines, move detailed content into reference files:

```
references/
  ├── [deep-topic-1].md    -- Detailed breakdown of one framework
  ├── [deep-topic-2].md    -- Templates, scripts, or examples
  └── [exercises].md       -- Worksheets or exercises
```

**In the main SKILL.md, point to reference files like:**
```markdown
For the complete [Framework Name] breakdown including templates and examples,
read `references/[filename].md`.
```

---

## Research Log Template

```markdown
# Research Log -- [Skill Name]

**Date:** YYYY-MM-DD
**Skill Built:** [skill-name]
**Research Mode:** [Known Expert / Topic Research]
**Expert(s):** [names]
**Total Videos Transcribed:** [count]
**Total Transcript Volume:** [approximate MB]

---

## Videos Transcribed

### [Expert/Source 1]
| # | Video ID | Title | Type | Key Findings |
|---|----------|-------|------|-------------|
| 1 | [id] | [title] | Channel / Interview | [brief] |
| 2 | [id] | [title] | Channel / Interview | [brief] |

### [Expert/Source 2] (if topic research mode)
| # | Video ID | Title | Type | Key Findings |
|---|----------|-------|------|-------------|

---

## Framework Inventory

| Framework Name | Source Video(s) | Confidence |
|---------------|----------------|------------|
| [name] | [IDs] | High / Medium / Low |

**Confidence levels:**
- **High**: Found in 2+ videos with consistent detail
- **Medium**: Found in 1 video with good detail
- **Low**: Mentioned briefly, may need supplemental research

---

## Gaps Identified

| Expected Content | Status | Notes |
|-----------------|--------|-------|
| [what was expected] | Not Found / Partial | [context] |

---

## Recency Notes

[Document any cases where newer content contradicted or evolved older content.
Always note which version was used in the skill file.]
```

---

## Analysis Output Format

When analyzing transcript batches, each analysis file should follow this structure:

```markdown
# Analysis: [Batch Name / Video Title]

## Frameworks Found
### [Framework Name]
- Source video: [title + ID]
- Upload date: [YYYYMMDD]
- Steps: [numbered list]
- Expert's explanation: [paraphrased or quoted]
- Key quote: "[exact words]"

## Principles & Beliefs
- [Principle]: [explanation + source video]

## Case Studies & Examples
- [Story/example]: [details + source video]

## Unique/Contrarian Takes
- [Take]: [context + source video]

## Tactical How-Tos
- [Technique]: [steps + source video]

## Evolution Notes
- [What changed]: [old view → new view + source videos with dates]
```

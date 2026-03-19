# Video Post Pipeline -- Technical Spec

**Date:** 2026-03-18
**Status:** Draft -- awaiting CIO approval
**Scope:** HeyGen Video Agent integration, Buffer social posting, video_post task type

---

## Overview

Add a video content pipeline: CMO drafts video scripts, they flow through Tier 2 approval, HeyGen renders the video (avatar or Video Agent mode), and Buffer schedules the result to X and TikTok.

**Key constraints:**
- 10 free HeyGen API credits/month -- every render must be tracked
- Avatar mode is the default (Digital Twin talking to camera). Video Agent is secondary (explainers, walkthroughs)
- Buffer handles video distribution to X and TikTok. Text-only tweets stay on direct `twitter.ts`
- Video rendering takes 2-10 minutes -- must be async, resilient to relay restarts

---

## Architecture

### Data Flow

```
CMO drafts video script (video_post:avatar or video_post:agent)
         |
         v
Tier 2 approval: COO review -> Telegram inline buttons -> CEO approves
         |
         v
relay.ts callback handler:
  1. Parses [VIDEO POST] block from task output into structured metadata
  2. Kicks off HeyGen render (avatar or Video Agent)
  3. Saves heygen_video_id to task metadata (JSONB merge, not replace)
  4. Sets task status to "rendering"
  5. Sends "Video rendering started" to Telegram
         |
         v
Video poller (setTimeout loop, 30s cycle, skip if previous still running):
  1. Queries tasks where status = 'rendering' AND metadata->>task_type = 'video_post'
  2. Checks HeyGen status for each (normalizes "waiting" -> "processing")
  3. On completion:
     a. Downloads video to temp file (stream, not in-memory)
     b. Uploads to Buffer with post caption
     c. Schedules to X + TikTok
     d. Sets task status to "completed", saves Buffer update IDs to metadata
     e. Sends confirmation + Buffer links to Telegram
     f. Cleans up temp file
  4. On failure:
     a. Sets task status to "failed"
     b. Sends error to Telegram
```

### New/Modified Files

| File | Change |
|------|--------|
| `src/utils/buffer.ts` | **New.** Buffer API client |
| `src/utils/heygen.ts` | **Modified.** Add Video Agent API functions |
| `src/workflows/video-pipeline.ts` | **New.** Orchestrates render -> download -> Buffer upload, includes [VIDEO POST] parser |
| `src/relay.ts` | **Modified.** Handle video_post approval callback, start poller, set task_type at creation, include "rendering" in /status |
| `src/workflows/approval.ts` | **Modified.** Add video_post trigger keywords to `determineAutonomyTier` |
| `config/agents/cmo.md` | **Modified.** Document video_post drafting format |
| `db/migrations/003-add-rendering-status.sql` | **New.** Add "rendering" to tasks status CHECK constraint |
| `.env` | **Modified.** Add BUFFER_ACCESS_TOKEN |

---

## 1. Buffer Integration (`src/utils/buffer.ts`)

### Environment

```
BUFFER_ACCESS_TOKEN=<token from Buffer settings>
```

### Exported Functions

```ts
function isConfigured(): boolean
// Returns true if BUFFER_ACCESS_TOKEN is set.

async function getProfiles(): Promise<BufferProfile[]>
// Lists connected social profiles (X, TikTok).
// Used at startup to resolve profile IDs for posting.
// GET https://api.bufferapp.com/1/profiles.json

async function createVideoPost(opts: {
  profileIds: string[];       // X and/or TikTok profile IDs
  text: string;               // Post caption/text
  videoFilePath: string;      // Path to temp video file on disk
  scheduledAt?: Date;         // Optional: schedule for later. Omit = add to queue
}): Promise<BufferPostResult>
// Uploads video via multipart POST to /1/media/upload.json, gets media_id,
// then creates post via POST /1/updates/create.json with media attachment.
// Single code path: always upload from local file. HeyGen CDN URL is downloaded
// to temp file first (in video-pipeline.ts), then passed here.

async function checkStatus(): Promise<"ok" | "error" | "not configured">
// Health check. GET /1/profiles.json and check for 200.
```

### Types

```ts
interface BufferProfile {
  id: string;
  service: "twitter" | "tiktok";
  handle: string;
}

interface BufferPostResult {
  success: boolean;
  updateIds: string[];  // Buffer update IDs (one per profile)
  error?: string;
}
```

### Buffer API Notes

- Buffer's API uses `access_token` as a query parameter on all requests
- Video upload uses multipart form POST to `/1/media/upload.json`, returns a `media_id`
- Post creation attaches `media[media_id]` to the update
- Buffer handles platform-specific formatting (aspect ratios, duration limits)
- TikTok via Buffer requires a Buffer paid plan with TikTok channel connected
- X API keys in `.env` are unrelated to Buffer -- Buffer uses its own stored OAuth tokens for connected profiles

---

## 2. HeyGen Video Agent API (`src/utils/heygen.ts`)

### New Functions (added alongside existing avatar functions)

```ts
interface CreateVideoAgentInput {
  title?: string;
  prompt: string;           // Natural language prompt describing the video
  aspectRatio?: "16:9" | "9:16" | "1:1";  // Default 9:16 for social
  duration?: number;         // Target duration in seconds
}

interface VideoAgentStatus {
  videoId: string;
  status: "pending" | "waiting" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
}

async function createVideoAgent(input: CreateVideoAgentInput): Promise<string | null>
// POST https://api.heygen.com/v2/video_agent/create
// Returns video_id for polling. Same polling flow as avatar videos.

async function getVideoAgentStatus(videoId: string): Promise<VideoAgentStatus | null>
// GET https://api.heygen.com/v2/video_agent/status?video_id=<id>
// Returns status + download URL on completion.
```

**Status normalization:** Both `VideoStatus` (avatar) and `VideoAgentStatus` (agent) include "waiting" and "pending" as valid states. The poller treats "pending", "waiting", and "processing" identically as "still in progress -- keep polling."

### Credit Tracking

```ts
interface CreditUsage {
  used: number;
  limit: number;
  remaining: number;
}

async function getApiCreditUsage(): Promise<CreditUsage>
// Primary: call existing getRemainingQuota() which queries GET /v2/user/remaining_quota.
// This returns remaining video minutes. Map to approximate credit count.
// Fallback (if API doesn't return credit-level data): track locally in Supabase
// using memory table with type = 'fact' and key = 'heygen_credits_YYYY_MM'.
// Increment on each successful createVideo / createVideoAgent call.
// Reset counter on 1st of month.

function checkCreditBudget(): Promise<{ allowed: boolean; remaining: number }>
// Returns false if 0 credits remain. Called before every render.
// On denial, sends "HeyGen credit limit reached (10/10 used)" to Telegram.
```

**Note:** The existing `getRemainingQuota()` function already queries HeyGen for remaining video minutes. Credit tracking should use this first, falling back to local tracking only if the API response doesn't map cleanly to API credit count.

### Avatar Mode Dimension Override

The existing `createVideo()` defaults to 1920x1080 (16:9). For social media video posts, the pipeline will pass explicit dimensions: `width: 1080, height: 1920` for 9:16 portrait. No changes to `createVideo`'s signature needed -- it already accepts `width` and `height` in `CreateVideoInput`.

### Existing Functions -- No Changes

`listAvatars`, `listVoices`, `createVideo`, `getVideoStatus`, `getRemainingQuota`, `checkStatus`, formatters -- all untouched. The Video Agent functions are additive.

---

## 3. Video Pipeline (`src/workflows/video-pipeline.ts`)

The orchestrator. Handles the full lifecycle from approval to social post.

### [VIDEO POST] Parser

```ts
function parseVideoPostBlock(output: string): {
  videoMode: "avatar" | "agent";
  script: string;
  caption: string;
  avatarId?: string;
  voiceId?: string;
} | null
```

Parses CMO's `[VIDEO POST]` structured block from task output text. Extracts Mode, Script, Caption, and optional Avatar/Voice fields. Returns null if no `[VIDEO POST]` block found.

**Called in `startVideoRender` before any HeyGen API calls.** The parsed fields are merged into task metadata via JSONB merge (not full replacement):

```sql
UPDATE tasks SET metadata = metadata || '{"video_mode": "avatar", "caption": "..."}'::jsonb
```

### Trigger (called from relay.ts on approval)

```ts
async function startVideoRender(opts: {
  bot: Bot;
  supabase: SupabaseClient;
  taskId: string;
  task: TaskRow;
}): Promise<void>
```

**Steps:**
1. Parse `[VIDEO POST]` block from `task.output` using `parseVideoPostBlock()`
2. Merge parsed fields into task metadata (JSONB merge via `metadata || new_fields`)
3. Call `checkCreditBudget()` -- abort if no credits remain
4. If avatar mode:
   - Use avatar ID and voice ID from parsed block (or defaults)
   - Call `createVideo()` with script, width: 1080, height: 1920 (9:16)
5. If agent mode:
   - Call `createVideoAgent()` with prompt, aspectRatio: "9:16"
6. Merge `heygen_video_id` into task metadata
7. Set task status to `"rendering"`
8. Send Telegram message: "Video rendering started. I'll notify you when it's ready for posting."

### Poller (runs on setTimeout loop in relay.ts)

```ts
async function pollRenderingVideos(opts: {
  bot: Bot;
  supabase: SupabaseClient;
}): Promise<void>
```

**Steps:**
1. Query tasks where `status = 'rendering'` and `metadata->>task_type = 'video_post'`
2. For each task:
   a. Read `video_mode` from metadata to choose status function
   b. Check HeyGen status (avatar: `getVideoStatus`, agent: `getVideoAgentStatus`)
   c. If status is "pending", "waiting", or "processing": skip (keep polling)
   d. If failed: update task status to `"failed"`, notify on Telegram
   e. If completed:
      - Download video from HeyGen URL to temp file (streaming fetch, not in-memory)
      - Get Buffer profile IDs for X and TikTok
      - Call `buffer.createVideoPost()` with temp file path + caption from metadata
      - Merge `buffer_update_ids` and `heygen_video_url` into task metadata
      - Update task status to `"completed"`
      - Send Telegram confirmation with preview link
      - Clean up temp file

**Polling config:**
- Uses `setTimeout` loop (not `setInterval`) -- schedules next poll only after current cycle completes, preventing overlap
- Interval: 30 seconds between cycles
- Max poll duration per video: 15 minutes from when `rendering` status was set (tracked via `metadata.render_started_at`). Fail if exceeded.
- Started in relay.ts `bot.start()` block
- Stopped on graceful shutdown by clearing the timeout handle

### Video Download

```ts
async function downloadVideo(url: string): Promise<string>
// Streams video from HeyGen CDN to a temp file.
// Returns the file path (not in-memory Buffer -- videos can be tens of MB).
// Caller is responsible for cleanup after upload.
```

---

## 4. Task Type: `video_post` (Tier 2)

### CMO Drafting Format

CMO drafts video posts using this structure in her output:

```
[VIDEO POST]
Mode: avatar (or agent)
Script: <the spoken script for avatar mode, or prompt for agent mode>
Caption: <the post text that accompanies the video on X/TikTok>
Avatar: <avatar ID, optional, uses default if omitted>
Voice: <voice ID, optional, uses default if omitted>
```

### Task Metadata Schema

```ts
{
  task_type: "video_post",
  video_mode: "avatar" | "agent",    // from CMO draft, default "avatar"
  script?: string,                    // parsed from [VIDEO POST] block
  caption?: string,                   // parsed from [VIDEO POST] block
  avatar_id?: string,                 // for avatar mode
  voice_id?: string,                  // for avatar mode
  heygen_video_id?: string,           // set after render starts
  heygen_video_url?: string,          // set after render completes
  render_started_at?: string,         // ISO timestamp, for timeout tracking
  buffer_update_ids?: string[],       // set after Buffer post created
  platforms: ["x", "tiktok"],         // target platforms
}
```

**Metadata is built incrementally via JSONB merge at each stage:**
1. Task creation (relay.ts): `{ task_type: "video_post" }`
2. Render start (video-pipeline.ts): merge `{ video_mode, script, caption, avatar_id, voice_id, heygen_video_id, render_started_at, platforms }`
3. Render complete (poller): merge `{ heygen_video_url, buffer_update_ids }`

### Task Creation in relay.ts

Parallel to the existing `isTweet` detection (relay.ts ~line 628-644), add `isVideoPost` detection:

```ts
const isVideoPost =
  (agentId === "cmo" || agentId === "head-content") &&
  (lower.includes("video post") ||
   lower.includes("video_post") ||
   lower.includes("video script") ||
   lower.includes("record a video") ||
   lower.includes("make a video"));

// In task insert:
...(isVideoPost ? { metadata: { task_type: "video_post" } } : {}),
```

This ensures `task_type: "video_post"` exists in metadata from creation, so the approval callback can match on it.

### Approval Flow Changes

**`determineAutonomyTier` in `approval.ts`:**

Add to the Tier 2 trigger block:
```ts
lower.includes("video post") ||
lower.includes("video_post") ||
lower.includes("video script") ||
lower.includes("record a video") ||
lower.includes("make a video")
```

**`relay.ts` callback handler (approve branch):**

After the existing tweet and voice_call blocks, add:
```ts
if (task?.metadata?.task_type === "video_post") {
  await startVideoRender({ bot, supabase, taskId: task.id, task });
}
```

**`relay.ts` /status command handler (~line 724):**

Add `"rendering"` to the status filter:
```ts
.in("status", ["pending", "in_progress", "awaiting_coo", "awaiting_approval", "rendering"])
```

### Changes Requested Flow

When a user clicks "Request Changes" on a video_post task, the existing handler re-runs the CMO agent and calls `submitForApproval`. The re-submitted task reuses the same task row, so `metadata.task_type = "video_post"` persists through the revision cycle. No additional handling needed -- the metadata survives because the changes_requested handler updates `output` and `status` but does not replace `metadata`.

---

## 5. CMO Agent Prompt Update (`config/agents/cmo.md`)

Add to CMO's system prompt:

```
## Video Posts (Tier 2)

You can draft video posts for X and TikTok. Use the [VIDEO POST] format:

[VIDEO POST]
Mode: avatar (default) or agent
Script: The spoken script (avatar mode) or descriptive prompt (agent mode)
Caption: The text that accompanies the video on social media

- Default to "avatar" mode. Crevita's Digital Twin talking to camera IS the brand.
- Use "agent" mode only for supplementary content: explainers, data visualizations,
  product walkthroughs -- anything where the face isn't the point.
- Keep scripts under 60 seconds for social media.
- Captions should be punchy, no em dashes, include relevant hashtags.
- All video posts require CEO approval before rendering.
```

---

## 6. Environment Variables

Add to `.env`:

```
BUFFER_ACCESS_TOKEN=<from Buffer app settings>
```

Existing variables used (no changes):
- `HEYGEN_API_KEY` -- already configured

---

## 7. Database Changes

### Migration: `db/migrations/003-add-rendering-status.sql`

The existing tasks table has a CHECK constraint on `status` that does not include `"rendering"`. This migration adds it:

```sql
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'pending', 'in_progress', 'awaiting_coo', 'awaiting_approval',
    'approved', 'rejected', 'changes_requested', 'completed', 'failed',
    'rendering'
  ));
```

### Credit Tracking

Use the existing `memory` table with `type = 'fact'` (a valid type in the CHECK constraint) and a key pattern `heygen_credits_YYYY_MM`:

```sql
-- Example: track March 2026 usage
INSERT INTO memory (type, key, value)
VALUES ('fact', 'heygen_credits_2026_03', '{"used": 3, "limit": 10}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Primary source of truth: `getRemainingQuota()` API call. Local tracking is the fallback if the API doesn't expose per-credit data.

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| Buffer not configured | Block video_post approval, notify: "Buffer not configured. Add BUFFER_ACCESS_TOKEN to .env" |
| HeyGen credits exhausted | Block render start, notify: "HeyGen credit limit reached (10/10). Video not rendered." |
| HeyGen render fails | Set task to "failed", notify with error message, do not post to Buffer |
| Buffer upload fails | Retry once, then set task to "failed", notify. Video URL preserved in metadata for manual retry |
| Video exceeds 15 min render time | Set task to "failed", notify: "Video render timed out" |
| Relay restarts during render | Poller picks up in-flight renders from DB on next cycle -- no lost videos |
| TikTok profile not connected in Buffer | Post to X only, warn: "TikTok not connected in Buffer. Posted to X only." |
| No [VIDEO POST] block in CMO output | Set task to "failed", notify: "Could not parse video post format from CMO draft." |

---

## 9. Testing Plan

1. **Unit: buffer.ts** -- mock Buffer API, verify post creation with media, error handling
2. **Unit: heygen.ts Video Agent** -- mock HeyGen API, verify createVideoAgent + status polling
3. **Unit: video-pipeline.ts** -- mock both APIs, verify full render -> download -> upload flow
4. **Unit: parseVideoPostBlock** -- verify parsing of CMO's [VIDEO POST] block, edge cases
5. **Integration: approval flow** -- verify video_post task goes through Tier 2, callback triggers render
6. **Integration: metadata flow** -- verify task_type set at creation, metadata merged (not replaced) through each stage
7. **Manual: end-to-end** -- CMO drafts video script, approve on Telegram, verify video appears on X/TikTok
8. **Edge: credit tracking** -- verify render blocked at 10/10 credits, counter resets on new month
9. **Edge: relay restart** -- start a render, restart relay, verify poller picks it up

---

## 10. Rollout Sequence

1. Run migration `003-add-rendering-status.sql` to add "rendering" to tasks status constraint
2. Add `BUFFER_ACCESS_TOKEN` to `.env`, connect X + TikTok in Buffer dashboard
3. Implement `buffer.ts` + health check
4. Add Video Agent functions to `heygen.ts` + credit tracking
5. Build `video-pipeline.ts` (parser, render orchestration, poller, download)
6. Wire into `relay.ts`: task_type detection at creation, approval callback, poller start, /status filter
7. Update `approval.ts` with video_post tier keywords
8. Update CMO system prompt with video post format
9. Manual end-to-end test with a real video

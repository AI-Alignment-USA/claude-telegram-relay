# Video Post Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a video content pipeline where CMO drafts video scripts, they flow through Tier 2 approval, HeyGen renders (avatar or Video Agent), and Buffer schedules the result to X and TikTok.

**Architecture:** State-machine approach -- approval triggers HeyGen render, saves video ID to task metadata, a setTimeout poller checks for completion and pushes to Buffer. All state lives in the tasks table's JSONB metadata column. New files: `src/utils/buffer.ts`, `src/workflows/video-pipeline.ts`. Modified: `src/utils/heygen.ts`, `src/relay.ts`, `src/workflows/approval.ts`, `config/agents/cmo.md`.

**Tech Stack:** Bun, TypeScript, grammY (Telegram), Supabase (Postgres), HeyGen API v2, Buffer API v1

**Spec:** `docs/superpowers/specs/2026-03-18-video-post-pipeline-design.md`

**Estimated total token cost:** ~120-160K tokens across all tasks

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `db/migrations/003-add-rendering-status.sql` | Create | Add "rendering" to tasks status CHECK constraint |
| `src/utils/buffer.ts` | Create | Buffer API client: auth, profiles, video post creation, health check |
| `src/utils/heygen.ts` | Modify | Add Video Agent API: createVideoAgent, getVideoAgentStatus, credit tracking |
| `src/workflows/video-pipeline.ts` | Create | [VIDEO POST] parser, render orchestration, poller, video download |
| `src/workflows/approval.ts` | Modify | Add video_post keywords to determineAutonomyTier (lines 239-253) |
| `src/relay.ts` | Modify | Task creation metadata (lines 627-648), approval callback (lines 307-366), /status filter (line 724), poller lifecycle (lines 1173-1177) |
| `config/agents/cmo.md` | Modify | Add Video Posts section documenting [VIDEO POST] format |
| `.env` | Modify | Add BUFFER_ACCESS_TOKEN |

---

### Task 1: Database Migration -- Add "rendering" Status

**Estimated tokens:** ~5K
**Files:**
- Create: `db/migrations/003-add-rendering-status.sql`

- [ ] **Step 1: Create migrations directory and SQL file**

```bash
mkdir -p db/migrations
```

```sql
-- db/migrations/003-add-rendering-status.sql
-- Add "rendering" status to tasks table for async video generation

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'pending', 'in_progress', 'awaiting_coo',
    'awaiting_approval', 'approved', 'rejected',
    'changes_requested', 'completed', 'failed',
    'rendering'
  ));
```

- [ ] **Step 2: Run migration via Supabase MCP**

Run the SQL via Supabase MCP `execute_sql` or paste into Supabase SQL Editor.
Expected: Constraint updated, no errors.

- [ ] **Step 3: Verify migration**

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'tasks_status_check';
```
Expected: Constraint definition includes `'rendering'`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/003-add-rendering-status.sql
git commit -m "db: add rendering status to tasks CHECK constraint"
```

---

### Task 2: Buffer API Client (`src/utils/buffer.ts`)

**Estimated tokens:** ~25-30K
**Files:**
- Create: `src/utils/buffer.ts`

- [ ] **Step 1: Create buffer.ts with types and isConfigured**

```ts
// src/utils/buffer.ts
/**
 * Buffer API Integration -- Social Media Video Posting
 *
 * Handles video uploads and post scheduling to X and TikTok.
 * Text-only tweets continue to use twitter.ts directly.
 *
 * Required env var: BUFFER_ACCESS_TOKEN
 */

const ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN || "";
const BASE = "https://api.bufferapp.com/1";

export interface BufferProfile {
  id: string;
  service: "twitter" | "tiktok" | string;
  handle: string;
}

export interface BufferPostResult {
  success: boolean;
  updateIds: string[];
  error?: string;
}

export function isConfigured(): boolean {
  return !!ACCESS_TOKEN;
}
```

- [ ] **Step 2: Implement getProfiles**

```ts
export async function getProfiles(): Promise<BufferProfile[]> {
  if (!ACCESS_TOKEN) return [];

  try {
    const res = await fetch(`${BASE}/profiles.json?access_token=${ACCESS_TOKEN}`);
    if (!res.ok) {
      console.error("Buffer getProfiles error:", res.status);
      return [];
    }

    const data = await res.json();
    return (data || []).map((p: any) => ({
      id: p.id,
      service: p.service,
      handle: p.service_username || "",
    }));
  } catch (e: any) {
    console.error("Buffer getProfiles error:", e.message);
    return [];
  }
}
```

- [ ] **Step 3: Implement createVideoPost with multipart upload**

```ts
import { randomBytes } from "crypto";
import { readFile } from "fs/promises";

export async function createVideoPost(opts: {
  profileIds: string[];
  text: string;
  videoFilePath: string;
  scheduledAt?: Date;
}): Promise<BufferPostResult> {
  if (!ACCESS_TOKEN) return { success: false, updateIds: [], error: "Buffer not configured" };

  try {
    // Step 1: Upload video via multipart
    const videoBytes = await readFile(opts.videoFilePath);
    const boundary = `----BunBoundary${randomBytes(8).toString("hex")}`;
    const encoder = new TextEncoder();

    const parts: Uint8Array[] = [];

    // access_token field
    parts.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${ACCESS_TOKEN}\r\n`
    ));

    // media file field
    parts.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
    ));
    parts.push(videoBytes);
    parts.push(encoder.encode("\r\n"));

    parts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    const uploadRes = await fetch(`${BASE}/media/upload.json`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("Buffer media upload error:", uploadRes.status, errText);
      return { success: false, updateIds: [], error: `Upload failed: ${uploadRes.status}` };
    }

    const uploadData = await uploadRes.json();
    const mediaId = uploadData.media?.id;

    if (!mediaId) {
      return { success: false, updateIds: [], error: "No media ID returned from upload" };
    }

    // Step 2: Create post with media attachment
    const postBody: Record<string, any> = {
      access_token: ACCESS_TOKEN,
      text: opts.text,
      profile_ids: opts.profileIds,
      media: { media_id: mediaId },
    };

    if (opts.scheduledAt) {
      postBody.scheduled_at = opts.scheduledAt.toISOString();
    }

    const postRes = await fetch(`${BASE}/updates/create.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
    });

    if (!postRes.ok) {
      const errText = await postRes.text();
      console.error("Buffer createPost error:", postRes.status, errText);
      return { success: false, updateIds: [], error: `Post creation failed: ${postRes.status}` };
    }

    const postData = await postRes.json();
    const updateIds = postData.updates
      ? postData.updates.map((u: any) => u.id)
      : [postData.update?.id].filter(Boolean);

    return { success: true, updateIds };
  } catch (e: any) {
    console.error("Buffer createVideoPost error:", e.message);
    return { success: false, updateIds: [], error: e.message };
  }
}
```

- [ ] **Step 4: Implement checkStatus**

```ts
export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!ACCESS_TOKEN) return "not configured";

  try {
    const res = await fetch(`${BASE}/profiles.json?access_token=${ACCESS_TOKEN}`);
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
```

- [ ] **Step 5: Test manually**

```bash
bun -e "import { isConfigured, checkStatus } from './src/utils/buffer.ts'; console.log('configured:', isConfigured()); console.log('status:', await checkStatus());"
```
Expected: `configured: false` (until BUFFER_ACCESS_TOKEN is set), `status: not configured`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/buffer.ts
git commit -m "feat: add Buffer API client for video post distribution"
```

---

### Task 3: HeyGen Video Agent API (`src/utils/heygen.ts`)

**Estimated tokens:** ~20-25K
**Files:**
- Modify: `src/utils/heygen.ts` (add after line 266, before FORMATTERS section)

- [ ] **Step 1: Add VideoAgent types after existing types block (after line 70)**

Add after the `QuotaInfo` interface (which ends at line 70):

```ts
export interface CreateVideoAgentInput {
  title?: string;
  prompt: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  duration?: number;
}

export interface VideoAgentStatus {
  videoId: string;
  status: "pending" | "waiting" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
}

export interface CreditUsage {
  used: number;
  limit: number;
  remaining: number;
}
```

- [ ] **Step 2: Add createVideoAgent function (after getRemainingQuota, before HEALTH CHECK)**

Insert before line 248 (`// HEALTH CHECK`):

```ts
// ============================================================
// VIDEO AGENT: Prompt-driven video generation with B-roll
// ============================================================

/**
 * Create a Video Agent video. Returns video_id for status polling.
 * Use for supplementary content: explainers, data visualizations, walkthroughs.
 */
export async function createVideoAgent(input: CreateVideoAgentInput): Promise<string | null> {
  if (!API_KEY) return null;

  const body: any = {
    title: input.title || "Playhouse STEM Video",
    prompt: input.prompt,
  };

  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (input.duration) body.duration = input.duration;

  try {
    const res = await fetch(`${BASE_V2}/video_agent/create`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("HeyGen createVideoAgent error:", res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.data?.video_id || null;
  } catch (e: any) {
    console.error("HeyGen createVideoAgent error:", e.message);
    return null;
  }
}

/**
 * Check Video Agent rendering status. Same polling pattern as avatar videos.
 */
export async function getVideoAgentStatus(videoId: string): Promise<VideoAgentStatus | null> {
  if (!API_KEY) return null;

  try {
    const res = await fetch(
      `${BASE_V2}/video_agent/status?video_id=${encodeURIComponent(videoId)}`,
      { headers: headers() }
    );

    if (!res.ok) {
      console.error("HeyGen getVideoAgentStatus error:", res.status);
      return null;
    }

    const data = await res.json();
    const d = data.data;

    return {
      videoId: d.id || videoId,
      status: d.status || "pending",
      videoUrl: d.video_url || undefined,
      thumbnailUrl: d.thumbnail_url || undefined,
      duration: d.duration || undefined,
      error: d.error || undefined,
    };
  } catch (e: any) {
    console.error("HeyGen getVideoAgentStatus error:", e.message);
    return null;
  }
}
```

- [ ] **Step 3: Add credit tracking functions (after getVideoAgentStatus)**

```ts
// ============================================================
// CREDIT TRACKING: 10 free API credits/month
// ============================================================

const MONTHLY_CREDIT_LIMIT = 10;

/**
 * Get current API credit usage. Uses getRemainingQuota() first,
 * falls back to local Supabase tracking if API doesn't expose credit count.
 *
 * Local tracking uses the memory table (schema: id, type, content, metadata, ...).
 * We store credits as: type='fact', content='heygen_credits_YYYY_MM',
 * metadata='{"used": N, "limit": 10}'.
 */
export async function getApiCreditUsage(supabase?: any): Promise<CreditUsage> {
  // Try HeyGen API first
  const quota = await getRemainingQuota();
  if (quota && quota.videoMinutes > 0) {
    // Map video minutes to approximate credits (rough heuristic)
    const used = MONTHLY_CREDIT_LIMIT - Math.min(MONTHLY_CREDIT_LIMIT, Math.floor(quota.videoMinutes));
    return { used, limit: MONTHLY_CREDIT_LIMIT, remaining: MONTHLY_CREDIT_LIMIT - used };
  }

  // Fallback: local tracking via Supabase memory table
  if (!supabase) return { used: 0, limit: MONTHLY_CREDIT_LIMIT, remaining: MONTHLY_CREDIT_LIMIT };

  const now = new Date();
  const creditKey = `heygen_credits_${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const { data } = await supabase
    .from("memory")
    .select("id, metadata")
    .eq("type", "fact")
    .eq("content", creditKey)
    .single();

  const used = data?.metadata?.used || 0;
  return { used, limit: MONTHLY_CREDIT_LIMIT, remaining: MONTHLY_CREDIT_LIMIT - used };
}

/**
 * Check if we have budget for another render. Call before every HeyGen render.
 */
export async function checkCreditBudget(supabase?: any): Promise<{ allowed: boolean; remaining: number }> {
  const usage = await getApiCreditUsage(supabase);
  return { allowed: usage.remaining > 0, remaining: usage.remaining };
}

/**
 * Increment the local credit counter after a successful render.
 * Uses memory table: type='fact', content=key string, metadata=JSON with usage.
 */
export async function incrementCreditUsage(supabase: any): Promise<void> {
  const now = new Date();
  const creditKey = `heygen_credits_${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const { data: existing } = await supabase
    .from("memory")
    .select("id, metadata")
    .eq("type", "fact")
    .eq("content", creditKey)
    .single();

  const newUsed = (existing?.metadata?.used || 0) + 1;

  if (existing) {
    await supabase
      .from("memory")
      .update({ metadata: { used: newUsed, limit: MONTHLY_CREDIT_LIMIT }, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("memory")
      .insert({ type: "fact", content: creditKey, metadata: { used: newUsed, limit: MONTHLY_CREDIT_LIMIT } });
  }
}
```

- [ ] **Step 4: Test manually**

```bash
bun -e "import { isConfigured, checkCreditBudget } from './src/utils/heygen.ts'; console.log('configured:', isConfigured()); console.log('budget:', await checkCreditBudget());"
```
Expected: Shows configured status and credit budget.

- [ ] **Step 5: Commit**

```bash
git add src/utils/heygen.ts
git commit -m "feat: add HeyGen Video Agent API + credit tracking"
```

---

### Task 4: Video Pipeline -- Parser (`src/workflows/video-pipeline.ts` part 1)

**Estimated tokens:** ~15-20K
**Files:**
- Create: `src/workflows/video-pipeline.ts`

- [ ] **Step 1: Create file with [VIDEO POST] parser**

```ts
// src/workflows/video-pipeline.ts
/**
 * Video Post Pipeline
 *
 * Orchestrates: CMO draft parsing -> HeyGen render -> Buffer upload
 * State machine: approved -> rendering -> completed/failed
 *
 * Avatar mode (default): Digital Twin talking to camera
 * Agent mode: B-roll explainers, data visualizations, walkthroughs
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bot } from "grammy";

const CHAT_ID = process.env.TELEGRAM_USER_ID || "";

// ============================================================
// [VIDEO POST] BLOCK PARSER
// ============================================================

export interface ParsedVideoPost {
  videoMode: "avatar" | "agent";
  script: string;
  caption: string;
  avatarId?: string;
  voiceId?: string;
}

/**
 * Parse CMO's [VIDEO POST] block from task output text.
 * Returns null if no valid block found.
 */
export function parseVideoPostBlock(output: string): ParsedVideoPost | null {
  const blockStart = output.indexOf("[VIDEO POST]");
  if (blockStart === -1) return null;

  const block = output.substring(blockStart);

  const modeMatch = block.match(/Mode:\s*(avatar|agent)/i);
  const scriptMatch = block.match(/Script:\s*(.+?)(?=\n(?:Caption|Avatar|Voice):|$)/s);
  const captionMatch = block.match(/Caption:\s*(.+?)(?=\n(?:Avatar|Voice):|$)/s);
  const avatarMatch = block.match(/Avatar:\s*(.+)/);
  const voiceMatch = block.match(/Voice:\s*(.+)/);

  const script = scriptMatch?.[1]?.trim();
  const caption = captionMatch?.[1]?.trim();

  if (!script || !caption) return null;

  return {
    videoMode: (modeMatch?.[1]?.toLowerCase() as "avatar" | "agent") || "avatar",
    script,
    caption,
    avatarId: avatarMatch?.[1]?.trim() || undefined,
    voiceId: voiceMatch?.[1]?.trim() || undefined,
  };
}
```

- [ ] **Step 2: Verify parser with inline test**

```bash
bun -e "
import { parseVideoPostBlock } from './src/workflows/video-pipeline.ts';

const testOutput = \`Here is the video post I drafted:

[VIDEO POST]
Mode: avatar
Script: Welcome to Playhouse STEM. Today we are talking about AI in early childhood education.
Caption: AI is changing how our kids learn. Here is what every parent needs to know. #PlayhouseSTEM #AIEducation
Avatar: josh_lite3_20230714
Voice: en_us_male_1\`;

const result = parseVideoPostBlock(testOutput);
console.log(JSON.stringify(result, null, 2));
console.assert(result !== null, 'Should parse successfully');
console.assert(result?.videoMode === 'avatar', 'Mode should be avatar');
console.assert(result?.caption.includes('#PlayhouseSTEM'), 'Caption should have hashtags');
console.assert(result?.avatarId === 'josh_lite3_20230714', 'Should extract avatar ID');
console.log('All parser tests passed');
"
```
Expected: Parsed object with all fields, "All parser tests passed".

- [ ] **Step 3: Commit**

```bash
git add src/workflows/video-pipeline.ts
git commit -m "feat: add VIDEO POST block parser for CMO drafts"
```

---

### Task 5: Video Pipeline -- Render Orchestration (part 2)

**Estimated tokens:** ~20-25K
**Files:**
- Modify: `src/workflows/video-pipeline.ts` (append after parser)

- [ ] **Step 1: Add imports and startVideoRender function**

Add at the top of the file, update the existing imports:

```ts
import {
  createVideo,
  createVideoAgent,
  checkCreditBudget,
  incrementCreditUsage,
} from "../utils/heygen.ts";
import * as buffer from "../utils/buffer.ts";
```

Then add after the parser:

```ts
// ============================================================
// RENDER TRIGGER (called from relay.ts on approval)
// ============================================================

/**
 * Start HeyGen video render after CEO approves a video_post task.
 * Parses CMO draft, kicks off render, sets task to "rendering".
 */
export async function startVideoRender(opts: {
  bot: Bot;
  supabase: SupabaseClient;
  taskId: string;
  taskOutput: string;
  taskMetadata: Record<string, any>;
}): Promise<void> {
  const { bot, supabase, taskId, taskOutput, taskMetadata } = opts;

  // Parse [VIDEO POST] block
  const parsed = parseVideoPostBlock(taskOutput);
  if (!parsed) {
    await supabase.from("tasks").update({ status: "failed" }).eq("id", taskId);
    await bot.api.sendMessage(
      CHAT_ID,
      "Could not parse [VIDEO POST] format from CMO draft. Video not rendered."
    );
    return;
  }

  // Check Buffer is configured
  if (!buffer.isConfigured()) {
    await supabase.from("tasks").update({ status: "failed" }).eq("id", taskId);
    await bot.api.sendMessage(
      CHAT_ID,
      "Buffer not configured. Add BUFFER_ACCESS_TOKEN to .env before rendering videos."
    );
    return;
  }

  // Check HeyGen credit budget
  const budget = await checkCreditBudget(supabase);
  if (!budget.allowed) {
    await supabase.from("tasks").update({ status: "failed" }).eq("id", taskId);
    await bot.api.sendMessage(
      CHAT_ID,
      `HeyGen credit limit reached (10/10 used this month). Video not rendered.`
    );
    return;
  }

  // Kick off HeyGen render
  let videoId: string | null = null;
  const videoMode = parsed.videoMode;

  if (videoMode === "avatar") {
    videoId = await createVideo({
      title: `Playhouse STEM - ${parsed.caption.substring(0, 40)}`,
      avatarId: parsed.avatarId || taskMetadata.default_avatar_id || "josh_lite3_20230714",
      voiceId: parsed.voiceId || taskMetadata.default_voice_id || "en_us_male_1",
      script: parsed.script,
      width: 1080,
      height: 1920,
    });
  } else {
    videoId = await createVideoAgent({
      title: `Playhouse STEM - ${parsed.caption.substring(0, 40)}`,
      prompt: parsed.script,
      aspectRatio: "9:16",
    });
  }

  if (!videoId) {
    await supabase.from("tasks").update({ status: "failed" }).eq("id", taskId);
    await bot.api.sendMessage(CHAT_ID, "HeyGen render failed to start. Check API key and quota.");
    return;
  }

  // Increment credit counter
  await incrementCreditUsage(supabase);

  // Merge new fields into task metadata (JSONB merge, not replace)
  const newMetadata = {
    ...taskMetadata,
    video_mode: videoMode,
    script: parsed.script,
    caption: parsed.caption,
    avatar_id: parsed.avatarId,
    voice_id: parsed.voiceId,
    heygen_video_id: videoId,
    render_started_at: new Date().toISOString(),
    platforms: ["x", "tiktok"],
  };

  await supabase
    .from("tasks")
    .update({ status: "rendering", metadata: newMetadata })
    .eq("id", taskId);

  await bot.api.sendMessage(
    CHAT_ID,
    `Video rendering started (${videoMode} mode, ${budget.remaining - 1} credits remaining).\n` +
    `I'll notify you when it's ready for posting.`
  );
}
```

- [ ] **Step 2: Verify imports compile**

```bash
bun build src/workflows/video-pipeline.ts --no-bundle 2>&1 | head -5
```
Expected: No import errors.

- [ ] **Step 3: Commit**

```bash
git add src/workflows/video-pipeline.ts
git commit -m "feat: add video render orchestration to pipeline"
```

---

### Task 6: Video Pipeline -- Poller and Download (part 3)

**Estimated tokens:** ~20-25K
**Files:**
- Modify: `src/workflows/video-pipeline.ts` (append after render orchestration)

**Note:** Tasks 4-6 all modify `video-pipeline.ts`. All imports should be consolidated at the top of the file. The imports shown here are additions to what was already added in Tasks 4 and 5. When implementing, merge all imports into one block at the file top.

- [ ] **Step 1: Add video download function**

Add these imports to the top of the file (merge with existing):

```ts
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// ============================================================
// VIDEO DOWNLOAD
// ============================================================

/**
 * Stream video from HeyGen CDN to a temp file. Returns file path.
 * Caller must clean up the file after Buffer upload.
 */
async function downloadVideo(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const bytes = await res.arrayBuffer();
  const tmpPath = join(tmpdir(), `heygen-${randomBytes(8).toString("hex")}.mp4`);
  await writeFile(tmpPath, Buffer.from(bytes));
  return tmpPath;
}
```

- [ ] **Step 2: Add poller function**

Add to the heygen import at the top of the file (merge with Task 5 imports):

```ts
import {
  createVideo,
  createVideoAgent,
  checkCreditBudget,
  incrementCreditUsage,
  getVideoStatus,
  getVideoAgentStatus,
} from "../utils/heygen.ts";

// ============================================================
// RENDER POLLER (setTimeout loop, 30s interval)
// ============================================================

const POLL_INTERVAL_MS = 30_000;
const MAX_RENDER_MINUTES = 15;

let pollTimeout: ReturnType<typeof setTimeout> | null = null;
let pollRunning = false;

/**
 * Poll all tasks in "rendering" status. Check HeyGen, download, upload to Buffer.
 * Uses setTimeout loop (not setInterval) to prevent overlapping cycles.
 */
export async function pollRenderingVideos(opts: {
  bot: Bot;
  supabase: SupabaseClient;
}): Promise<void> {
  if (pollRunning) return;
  pollRunning = true;

  const { bot, supabase } = opts;

  try {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, metadata, output")
      .eq("status", "rendering")
      .eq("metadata->>task_type", "video_post");

    if (!tasks || tasks.length === 0) return;

    for (const task of tasks) {
      const meta = task.metadata || {};
      const videoId = meta.heygen_video_id;
      if (!videoId) continue;

      // Check render timeout
      if (meta.render_started_at) {
        const elapsed = Date.now() - new Date(meta.render_started_at).getTime();
        if (elapsed > MAX_RENDER_MINUTES * 60 * 1000) {
          await supabase.from("tasks").update({ status: "failed" }).eq("id", task.id);
          await bot.api.sendMessage(CHAT_ID, `Video render timed out after ${MAX_RENDER_MINUTES} minutes.`);
          continue;
        }
      }

      // Check HeyGen status based on video mode
      const videoMode = meta.video_mode || "avatar";
      let status: string | undefined;
      let videoUrl: string | undefined;

      if (videoMode === "avatar") {
        const result = await getVideoStatus(videoId);
        status = result?.status;
        videoUrl = result?.videoUrl;
      } else {
        const result = await getVideoAgentStatus(videoId);
        status = result?.status;
        videoUrl = result?.videoUrl;
      }

      // Still rendering -- skip
      if (status === "pending" || status === "waiting" || status === "processing") continue;

      // Failed
      if (status === "failed" || !status) {
        await supabase.from("tasks").update({ status: "failed" }).eq("id", task.id);
        await bot.api.sendMessage(CHAT_ID, `Video render failed (${videoMode} mode). HeyGen status: ${status || "unknown"}`);
        continue;
      }

      // Completed -- download and post to Buffer
      if (status === "completed" && videoUrl) {
        let tmpPath: string | undefined;
        try {
          tmpPath = await downloadVideo(videoUrl);

          // Get Buffer profiles for X and TikTok
          const profiles = await buffer.getProfiles();
          const targetProfiles = profiles.filter(
            (p) => p.service === "twitter" || p.service === "tiktok"
          );

          if (targetProfiles.length === 0) {
            await supabase.from("tasks").update({
              status: "failed",
              metadata: { ...meta, heygen_video_url: videoUrl },
            }).eq("id", task.id);
            await bot.api.sendMessage(CHAT_ID, "No X or TikTok profiles connected in Buffer. Video saved but not posted.");
            continue;
          }

          const caption = meta.caption || "New video from Playhouse STEM";
          const profileIds = targetProfiles.map((p) => p.id);
          const postResult = await buffer.createVideoPost({
            profileIds,
            text: caption,
            videoFilePath: tmpPath,
          });

          // Retry once on failure
          if (!postResult.success) {
            const retryResult = await buffer.createVideoPost({
              profileIds,
              text: caption,
              videoFilePath: tmpPath,
            });

            if (!retryResult.success) {
              await supabase.from("tasks").update({
                status: "failed",
                metadata: { ...meta, heygen_video_url: videoUrl },
              }).eq("id", task.id);
              await bot.api.sendMessage(
                CHAT_ID,
                `Buffer upload failed after retry: ${retryResult.error}\nVideo URL saved in task for manual posting.`
              );
              continue;
            }

            // Retry succeeded
            postResult.updateIds = retryResult.updateIds;
            postResult.success = true;
          }

          // Success -- update task and notify
          await supabase.from("tasks").update({
            status: "completed",
            completed_at: new Date().toISOString(),
            metadata: {
              ...meta,
              heygen_video_url: videoUrl,
              buffer_update_ids: postResult.updateIds,
            },
          }).eq("id", task.id);

          const platforms = targetProfiles.map((p) => p.service).join(" + ");
          const tiktokMissing = !targetProfiles.some((p) => p.service === "tiktok");
          let msg = `Video posted to ${platforms} via Buffer.`;
          if (tiktokMissing) {
            msg += "\nTikTok not connected in Buffer. Posted to X only.";
          }
          await bot.api.sendMessage(CHAT_ID, msg);
        } catch (e: any) {
          console.error("Video pipeline completion error:", e.message);
          await supabase.from("tasks").update({
            status: "failed",
            metadata: { ...meta, heygen_video_url: videoUrl },
          }).eq("id", task.id);
          await bot.api.sendMessage(CHAT_ID, `Video pipeline error: ${e.message}`);
        } finally {
          // Clean up temp file
          if (tmpPath) {
            try { await unlink(tmpPath); } catch {}
          }
        }
      }
    }
  } catch (e: any) {
    console.error("Video poller error:", e.message);
  } finally {
    pollRunning = false;
  }
}

/**
 * Start the polling loop. Call once from relay.ts bot.start().
 */
export function startVideoPoller(bot: Bot, supabase: SupabaseClient): void {
  function schedule() {
    pollTimeout = setTimeout(async () => {
      await pollRenderingVideos({ bot, supabase });
      schedule();
    }, POLL_INTERVAL_MS);
  }
  schedule();
  console.log("Video render poller started (30s interval)");
}

/**
 * Stop the polling loop. Call on graceful shutdown.
 */
export function stopVideoPoller(): void {
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
    console.log("Video render poller stopped");
  }
}
```

- [ ] **Step 2: Verify full file compiles**

```bash
bun build src/workflows/video-pipeline.ts --no-bundle 2>&1 | head -10
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/workflows/video-pipeline.ts
git commit -m "feat: add video render poller and download to pipeline"
```

---

### Task 7: Wire into relay.ts -- Task Creation and Approval Callback

**Estimated tokens:** ~15-20K
**Files:**
- Modify: `src/relay.ts` (lines 10-30 imports, lines 627-648 task creation, lines 307-366 approval callback, line 724 /status)

- [ ] **Step 1: Add imports at top of relay.ts (after line 30)**

Add after the existing imports:

```ts
import {
  startVideoRender,
  startVideoPoller,
  stopVideoPoller,
} from "./workflows/video-pipeline.ts";
```

- [ ] **Step 2: Add isVideoPost detection at task creation (after line 633)**

In the `handleAgentCommand` function, after the `isTweet` detection block (line 633), add:

```ts
    const isVideoPost =
      (agent.id === "cmo" || agent.id === "head-content") &&
      (lowerMsg.includes("video post") ||
       lowerMsg.includes("video_post") ||
       lowerMsg.includes("video script") ||
       lowerMsg.includes("record a video") ||
       lowerMsg.includes("make a video"));
```

Then modify the metadata line in the task insert (line 644). Replace:

```ts
        ...(isTweet ? { metadata: { task_type: "tweet" } } : {}),
```

With:

```ts
        ...(isTweet ? { metadata: { task_type: "tweet" } }
          : isVideoPost ? { metadata: { task_type: "video_post" } }
          : {}),
```

- [ ] **Step 3: Add video_post handler in approval callback (after line 366)**

After the tweet posting block that ends at line 366, add:

```ts
      // Start video render on video_post approval
      if (task?.metadata?.task_type === "video_post" && task?.output) {
        await startVideoRender({
          bot,
          supabase,
          taskId,
          taskOutput: task.output,
          taskMetadata: task.metadata || {},
        });
      }
```

- [ ] **Step 4: Update /status filter (line 724)**

Replace:
```ts
      .in("status", ["pending", "in_progress", "awaiting_coo", "awaiting_approval"])
```

With:
```ts
      .in("status", ["pending", "in_progress", "awaiting_coo", "awaiting_approval", "rendering"])
```

- [ ] **Step 5: Add `output` to the task select in the approval callback (line 311)**

The existing approval callback selects `metadata, output, agent_id`. Verify `output` is already included. At line 311:

```ts
        .select("metadata, output, agent_id")
```

`output` is already selected -- no change needed.

- [ ] **Step 6: Start/stop poller in bot lifecycle (lines 1122-1177)**

In the SIGINT handler (line 122), add before `process.exit(0)`:
```ts
  stopVideoPoller();
```

In the SIGTERM handler (line 126), add before `process.exit(0)`:
```ts
  stopVideoPoller();
```

In the `bot.start()` block (line 1173), update to:
```ts
bot.start({
  onStart: () => {
    console.log("Bot is running!");
    if (supabase) {
      startVideoPoller(bot, supabase);
    }
  },
});
```

- [ ] **Step 7: Verify relay compiles**

```bash
bun build src/relay.ts --no-bundle 2>&1 | head -10
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/relay.ts
git commit -m "feat: wire video_post pipeline into relay approval flow and poller"
```

---

### Task 8: Update Approval Tier Detection

**Estimated tokens:** ~5K
**Files:**
- Modify: `src/workflows/approval.ts` (lines 239-253)

- [ ] **Step 1: Add video_post keywords to Tier 2 triggers**

In `determineAutonomyTier`, add to the Tier 2 `if` block (after line 252 `lower.includes("voice call")`):

```ts
    lower.includes("video post") ||
    lower.includes("video_post") ||
    lower.includes("video script") ||
    lower.includes("record a video") ||
    lower.includes("make a video") ||
```

- [ ] **Step 2: Verify compile**

```bash
bun build src/workflows/approval.ts --no-bundle 2>&1 | head -5
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/workflows/approval.ts
git commit -m "feat: add video_post keywords to Tier 2 autonomy detection"
```

---

### Task 9: Update CMO System Prompt

**Estimated tokens:** ~5K
**Files:**
- Modify: `config/agents/cmo.md` (append after Content Guidelines section, before Security Protocols)

- [ ] **Step 1: Add Video Posts section**

After line 29 (end of Content Guidelines) and before line 31 (Security Protocols), add:

```markdown
## Video Posts (Tier 2)

You can draft video posts for X and TikTok. Use the [VIDEO POST] format:

[VIDEO POST]
Mode: avatar (default) or agent
Script: The spoken script (avatar mode) or descriptive prompt (agent mode)
Caption: The text that accompanies the video on social media

- Default to "avatar" mode. Crevita's Digital Twin talking to camera IS the brand.
- Use "agent" mode only for supplementary content: explainers, data visualizations, product walkthroughs, anything where the face isn't the point.
- Keep scripts under 60 seconds for social media.
- Captions should be punchy, no em dashes, include relevant hashtags.
- All video posts require CEO approval before rendering.
```

- [ ] **Step 2: Commit**

```bash
git add config/agents/cmo.md
git commit -m "feat: add video post drafting format to CMO system prompt"
```

---

### Task 10: Environment Setup and End-to-End Verification

**Estimated tokens:** ~10-15K
**Files:**
- Modify: `.env` (add BUFFER_ACCESS_TOKEN)

- [ ] **Step 1: Add BUFFER_ACCESS_TOKEN to .env**

Append to `.env`:
```
BUFFER_ACCESS_TOKEN=
```

Leave value empty -- CIO will fill in after creating Buffer account.

- [ ] **Step 2: Verify all new imports resolve**

```bash
bun build src/relay.ts --no-bundle 2>&1 | head -20
```
Expected: Clean build, no errors.

- [ ] **Step 3: Run existing tests to verify no regressions**

```bash
bun run test:telegram && bun run test:supabase
```
Expected: Both pass.

- [ ] **Step 4: Verify Buffer health check**

```bash
bun -e "import { checkStatus } from './src/utils/buffer.ts'; console.log(await checkStatus());"
```
Expected: `not configured` (until token is added).

- [ ] **Step 5: Verify HeyGen health check + credit budget**

```bash
bun -e "import { checkStatus, checkCreditBudget } from './src/utils/heygen.ts'; console.log('status:', await checkStatus()); console.log('budget:', await checkCreditBudget());"
```
Expected: `ok` (if HEYGEN_API_KEY is set), budget shows remaining credits.

- [ ] **Step 6: Dry-run parser with a sample CMO draft**

```bash
bun -e "
import { parseVideoPostBlock } from './src/workflows/video-pipeline.ts';
const sample = '[VIDEO POST]\nMode: avatar\nScript: Welcome to Playhouse STEM.\nCaption: AI is changing education. #AI';
const r = parseVideoPostBlock(sample);
console.log(r);
console.assert(r?.videoMode === 'avatar');
console.assert(r?.script === 'Welcome to Playhouse STEM.');
console.log('Parser OK');
"
```
Expected: Parsed result, "Parser OK".

- [ ] **Step 7: Commit .env update**

```bash
git add .env
git commit -m "chore: add BUFFER_ACCESS_TOKEN placeholder to .env"
```

- [ ] **Step 8: Final integration commit message**

Review all commits made during this plan. If anything was missed, add it now.

---

## Pre-Flight Checklist (Before Live Testing)

Before the first real video render, the CIO must:

1. **Buffer account**: Create at bufferapp.com, connect @CrevitaMoody on X and TikTok account
2. **Buffer token**: Generate access token at Buffer Settings > API, paste into `.env` as `BUFFER_ACCESS_TOKEN`
3. **Run migration**: Execute `db/migrations/003-add-rendering-status.sql` in Supabase
4. **Restart relay**: `bunx pm2 restart relay` or restart the launchd service
5. **Test**: Send `/cmo draft a video post about AI in early childhood education` on Telegram, approve the draft, watch it flow through rendering and posting

## Dependency Graph

```
Task 1 (DB migration) ──────────────────────┐
Task 2 (buffer.ts) ──────────────────────────┤
Task 3 (heygen.ts additions) ────────────────┤
                                              ├─> Task 7 (relay.ts wiring)
Task 4 (pipeline parser) ───┐                │
Task 5 (pipeline render) ───┤                │
Task 6 (pipeline poller) ───┘────────────────┤
                                              ├─> Task 10 (e2e verification)
Task 8 (approval.ts) ───────────────────────┤
Task 9 (CMO prompt) ────────────────────────┘
```

**Parallelizable:** Tasks 1, 2, 3, 4 can all run in parallel. Tasks 5-6 depend on 3-4. Tasks 7-9 depend on 2-6. Task 10 depends on everything.

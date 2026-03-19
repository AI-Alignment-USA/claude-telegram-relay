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
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import {
  createVideo,
  createVideoAgent,
  checkCreditBudget,
  incrementCreditUsage,
  getVideoStatus,
  getVideoAgentStatus,
} from "../utils/heygen.ts";
import * as buffer from "../utils/buffer.ts";

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
 *
 * Expected format:
 * [VIDEO POST]
 * Mode: avatar (or agent)
 * Script: <spoken script or prompt>
 * Caption: <post text for X/TikTok>
 * Avatar: <optional avatar ID>
 * Voice: <optional voice ID>
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
      "HeyGen credit limit reached (10/10 used this month). Video not rendered."
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

  // Merge new fields into task metadata (spread preserves existing keys)
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
    "I'll notify you when it's ready for posting."
  );
}

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
          let postResult = await buffer.createVideoPost({
            profileIds,
            text: caption,
            videoFilePath: tmpPath,
          });

          // Retry once on failure
          if (!postResult.success) {
            postResult = await buffer.createVideoPost({
              profileIds,
              text: caption,
              videoFilePath: tmpPath,
            });
          }

          if (!postResult.success) {
            await supabase.from("tasks").update({
              status: "failed",
              metadata: { ...meta, heygen_video_url: videoUrl },
            }).eq("id", task.id);
            await bot.api.sendMessage(
              CHAT_ID,
              `Buffer upload failed after retry: ${postResult.error}\nVideo URL saved in task for manual posting.`
            );
            continue;
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

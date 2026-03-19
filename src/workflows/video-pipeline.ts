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

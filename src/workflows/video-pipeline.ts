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

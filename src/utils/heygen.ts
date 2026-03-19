/**
 * HeyGen API Integration — AI Avatar Video Generation
 *
 * CIO: manages technical integration, lists avatars/voices
 * CMO: submits video scripts through approval chain
 * CIO: sends approved scripts to HeyGen for rendering
 * Video generation is Tier 2 (CEO approval required before rendering)
 *
 * Required env var: HEYGEN_API_KEY
 */

import { logIntegrationCall } from "./integration-logger.ts";

const API_KEY = process.env.HEYGEN_API_KEY || "";
const BASE_V2 = "https://api.heygen.com/v2";
const BASE_V1 = "https://api.heygen.com/v1";

export function isConfigured(): boolean {
  return !!API_KEY;
}

function headers(): Record<string, string> {
  return {
    "x-api-key": API_KEY,
    "Content-Type": "application/json",
  };
}

// ============================================================
// TYPES
// ============================================================

export interface AvatarInfo {
  avatarId: string;
  name: string;
  gender: string;
  previewImage: string;
  premium: boolean;
}

export interface VoiceInfo {
  voiceId: string;
  name: string;
  language: string;
  gender: string;
  previewAudio: string;
  emotionSupport: boolean;
}

export interface CreateVideoInput {
  title?: string;
  avatarId: string;
  voiceId: string;
  script: string;
  avatarStyle?: "normal" | "circle" | "closeUp";
  emotion?: "Excited" | "Friendly" | "Serious" | "Soothing" | "Broadcaster";
  width?: number;
  height?: number;
}

export interface VideoStatus {
  videoId: string;
  status: "pending" | "waiting" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
}

export interface QuotaInfo {
  videoMinutes: number;
}

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

// ============================================================
// LIST: Avatars
// ============================================================

export async function listAvatars(): Promise<AvatarInfo[]> {
  if (!API_KEY) return [];

  try {
    const res = await fetch(`${BASE_V2}/avatars`, { headers: headers() });
    if (!res.ok) {
      await logIntegrationCall("heygen", "system", "v2/avatars", "error", `${res.status}`);
      console.error("HeyGen listAvatars error:", res.status);
      return [];
    }

    await logIntegrationCall("heygen", "system", "v2/avatars", "success");
    const data = await res.json();
    return (data.data?.avatars || []).map((a: any) => ({
      avatarId: a.avatar_id,
      name: a.avatar_name,
      gender: a.gender || "",
      previewImage: a.preview_image_url || "",
      premium: a.premium || false,
    }));
  } catch (e: any) {
    await logIntegrationCall("heygen", "system", "v2/avatars", "error", e.message);
    console.error("HeyGen listAvatars error:", e.message);
    return [];
  }
}

// ============================================================
// LIST: Voices
// ============================================================

export async function listVoices(): Promise<VoiceInfo[]> {
  if (!API_KEY) return [];

  try {
    const res = await fetch(`${BASE_V2}/voices`, { headers: headers() });
    if (!res.ok) {
      await logIntegrationCall("heygen", "system", "v2/voices", "error", `${res.status}`);
      console.error("HeyGen listVoices error:", res.status);
      return [];
    }

    await logIntegrationCall("heygen", "system", "v2/voices", "success");
    const data = await res.json();
    return (data.data?.voices || []).map((v: any) => ({
      voiceId: v.voice_id,
      name: v.name || "",
      language: v.language || "",
      gender: v.gender || "",
      previewAudio: v.preview_audio || "",
      emotionSupport: v.emotion_support || false,
    }));
  } catch (e: any) {
    await logIntegrationCall("heygen", "system", "v2/voices", "error", e.message);
    console.error("HeyGen listVoices error:", e.message);
    return [];
  }
}

// ============================================================
// CREATE: Video (Tier 2 — CEO approval required)
// ============================================================

/**
 * Submit a video for rendering. Only call after CEO approval.
 * Returns a video_id for status polling.
 */
export async function createVideo(input: CreateVideoInput): Promise<string | null> {
  if (!API_KEY) return null;

  const body: any = {
    title: input.title || "Playhouse STEM Video",
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: input.avatarId,
          avatar_style: input.avatarStyle || "normal",
        },
        voice: {
          type: "text",
          voice_id: input.voiceId,
          input_text: input.script,
          speed: 1.0,
        },
      },
    ],
    dimension: {
      width: input.width || 1920,
      height: input.height || 1080,
    },
  };

  // Add emotion if specified and supported
  if (input.emotion) {
    body.video_inputs[0].voice.emotion = input.emotion;
  }

  try {
    const res = await fetch(`${BASE_V2}/video/generate`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      await logIntegrationCall("heygen", "system", "v2/video/generate", "error", `${res.status}: ${errText}`);
      console.error("HeyGen createVideo error:", res.status, errText);
      return null;
    }

    await logIntegrationCall("heygen", "system", "v2/video/generate", "success");
    const data = await res.json();
    return data.data?.video_id || null;
  } catch (e: any) {
    await logIntegrationCall("heygen", "system", "v2/video/generate", "error", e.message);
    console.error("HeyGen createVideo error:", e.message);
    return null;
  }
}

// ============================================================
// STATUS: Video rendering progress
// ============================================================

export async function getVideoStatus(videoId: string): Promise<VideoStatus | null> {
  if (!API_KEY) return null;

  try {
    const res = await fetch(
      `${BASE_V1}/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      { headers: headers() }
    );

    if (!res.ok) {
      await logIntegrationCall("heygen", "system", "v1/video_status.get", "error", `${res.status}`);
      console.error("HeyGen getVideoStatus error:", res.status);
      return null;
    }

    await logIntegrationCall("heygen", "system", "v1/video_status.get", "success");
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
    await logIntegrationCall("heygen", "system", "v1/video_status.get", "error", e.message);
    console.error("HeyGen getVideoStatus error:", e.message);
    return null;
  }
}

// ============================================================
// QUOTA: Remaining video minutes
// ============================================================

export async function getRemainingQuota(): Promise<QuotaInfo | null> {
  if (!API_KEY) return null;

  try {
    const res = await fetch(`${BASE_V2}/user/remaining_quota`, {
      headers: headers(),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      videoMinutes: data.data?.remaining_quota?.character_video_minutes || 0,
    };
  } catch {
    return null;
  }
}

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
      await logIntegrationCall("heygen", "system", "v2/video_agent/create", "error", `${res.status}: ${errText}`);
      console.error("HeyGen createVideoAgent error:", res.status, errText);
      return null;
    }

    await logIntegrationCall("heygen", "system", "v2/video_agent/create", "success");
    const data = await res.json();
    return data.data?.video_id || null;
  } catch (e: any) {
    await logIntegrationCall("heygen", "system", "v2/video_agent/create", "error", e.message);
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
      await logIntegrationCall("heygen", "system", "v2/video_agent/status", "error", `${res.status}`);
      console.error("HeyGen getVideoAgentStatus error:", res.status);
      return null;
    }

    await logIntegrationCall("heygen", "system", "v2/video_agent/status", "success");
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
    await logIntegrationCall("heygen", "system", "v2/video_agent/status", "error", e.message);
    console.error("HeyGen getVideoAgentStatus error:", e.message);
    return null;
  }
}

// ============================================================
// CREDIT TRACKING: 10 free API credits/month
// ============================================================

const MONTHLY_CREDIT_LIMIT = 10;

/**
 * Get current API credit usage. Uses getRemainingQuota() first,
 * falls back to local Supabase tracking if API doesn't expose credit count.
 */
export async function getApiCreditUsage(supabase?: any): Promise<CreditUsage> {
  const quota = await getRemainingQuota();
  if (quota && quota.videoMinutes > 0) {
    const used = MONTHLY_CREDIT_LIMIT - Math.min(MONTHLY_CREDIT_LIMIT, Math.floor(quota.videoMinutes));
    return { used, limit: MONTHLY_CREDIT_LIMIT, remaining: MONTHLY_CREDIT_LIMIT - used };
  }

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

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Ping the HeyGen API. Returns status for dashboard health check.
 * Uses the quota endpoint as a lightweight key validator.
 */
export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!API_KEY) return "not configured";

  try {
    const res = await fetch(`${BASE_V2}/user/remaining_quota`, {
      headers: headers(),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// FORMATTERS
// ============================================================

export function formatAvatarList(avatars: AvatarInfo[], limit: number = 10): string {
  if (avatars.length === 0) return "No avatars available.";

  const lines = [`${avatars.length} avatar(s) available:`];
  for (const a of avatars.slice(0, limit)) {
    const tag = a.premium ? " [premium]" : "";
    lines.push(`  - ${a.name} (${a.avatarId})${tag}`);
  }
  if (avatars.length > limit) {
    lines.push(`  ... and ${avatars.length - limit} more`);
  }
  return lines.join("\n");
}

export function formatVoiceList(voices: VoiceInfo[], limit: number = 10): string {
  if (voices.length === 0) return "No voices available.";

  const lines = [`${voices.length} voice(s) available:`];
  for (const v of voices.slice(0, limit)) {
    const emotion = v.emotionSupport ? " [emotion]" : "";
    lines.push(`  - ${v.name} (${v.language}, ${v.gender})${emotion}`);
  }
  if (voices.length > limit) {
    lines.push(`  ... and ${voices.length - limit} more`);
  }
  return lines.join("\n");
}

export function formatVideoStatus(status: VideoStatus): string {
  const lines = [`Video ${status.videoId}:`, `  Status: ${status.status}`];

  if (status.duration) {
    lines.push(`  Duration: ${status.duration.toFixed(1)}s`);
  }
  if (status.videoUrl) {
    lines.push(`  URL: ${status.videoUrl}`);
  }
  if (status.error) {
    lines.push(`  Error: ${status.error}`);
  }

  return lines.join("\n");
}

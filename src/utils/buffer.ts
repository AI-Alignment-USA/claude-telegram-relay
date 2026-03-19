/**
 * Buffer API Integration
 *
 * Video posting to X (Twitter) and TikTok via Buffer's scheduling platform.
 * Two-step flow: upload video via multipart, then create a scheduled post.
 *
 * Required env var: BUFFER_ACCESS_TOKEN
 */

import { randomBytes } from "crypto";
import { readFile } from "fs/promises";

const ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN || "";

const BASE_URL = "https://api.bufferapp.com/1";

// ============================================================
// TYPES
// ============================================================

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

// ============================================================
// CONFIG & HEALTH
// ============================================================

export function isConfigured(): boolean {
  return !!ACCESS_TOKEN;
}

export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    const res = await fetch(
      `${BASE_URL}/profiles.json?access_token=${ACCESS_TOKEN}`
    );
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// PROFILES
// ============================================================

export async function getProfiles(): Promise<BufferProfile[]> {
  if (!isConfigured()) {
    console.error("Buffer not configured");
    return [];
  }

  try {
    const res = await fetch(
      `${BASE_URL}/profiles.json?access_token=${ACCESS_TOKEN}`
    );

    if (!res.ok) {
      console.error("Buffer getProfiles error:", res.status, await res.text());
      return [];
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error("Buffer getProfiles: unexpected response shape");
      return [];
    }

    return data.map((p: any) => ({
      id: p.id,
      service: p.service,
      handle: p.formatted_username || p.service_username || "",
    }));
  } catch (e: any) {
    console.error("Buffer getProfiles error:", e.message);
    return [];
  }
}

// ============================================================
// VIDEO UPLOAD
// ============================================================

async function uploadVideo(videoFilePath: string): Promise<string | null> {
  try {
    const videoBuffer = await readFile(videoFilePath);
    const boundary = `----BunBoundary${randomBytes(8).toString("hex")}`;

    const parts: Uint8Array[] = [];
    const encoder = new TextEncoder();

    // access_token field
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n`
      )
    );
    parts.push(encoder.encode(ACCESS_TOKEN));
    parts.push(encoder.encode("\r\n"));

    // media file field
    const fileName = videoFilePath.split(/[\\/]/).pop() || "video.mp4";
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: video/mp4\r\n\r\n`
      )
    );
    parts.push(new Uint8Array(videoBuffer.buffer, videoBuffer.byteOffset, videoBuffer.byteLength));
    parts.push(encoder.encode("\r\n"));

    parts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    const res = await fetch(`${BASE_URL}/media/upload.json`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      console.error("Buffer video upload error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return data.id || data.media_id || null;
  } catch (e: any) {
    console.error("Buffer video upload error:", e.message);
    return null;
  }
}

// ============================================================
// CREATE VIDEO POST
// ============================================================

export async function createVideoPost(opts: {
  profileIds: string[];
  text: string;
  videoFilePath: string;
  scheduledAt?: Date;
}): Promise<BufferPostResult> {
  if (!isConfigured()) {
    console.error("Buffer not configured");
    return { success: false, updateIds: [], error: "Buffer not configured" };
  }

  try {
    // Step 1: Upload video
    const mediaId = await uploadVideo(opts.videoFilePath);
    if (!mediaId) {
      return { success: false, updateIds: [], error: "Video upload failed" };
    }

    // Step 2: Create post
    const payload: Record<string, any> = {
      access_token: ACCESS_TOKEN,
      profile_ids: opts.profileIds,
      text: opts.text,
      media: { media_id: mediaId },
    };

    if (opts.scheduledAt) {
      payload.scheduled_at = opts.scheduledAt.toISOString();
    }

    const res = await fetch(`${BASE_URL}/updates/create.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Buffer createVideoPost error:", res.status, errText);
      return {
        success: false,
        updateIds: [],
        error: `HTTP ${res.status}: ${errText}`,
      };
    }

    const data = await res.json();

    const updateIds: string[] = Array.isArray(data.updates)
      ? data.updates.map((u: any) => u.id).filter(Boolean)
      : [];

    return { success: true, updateIds };
  } catch (e: any) {
    console.error("Buffer createVideoPost error:", e.message);
    return { success: false, updateIds: [], error: e.message };
  }
}

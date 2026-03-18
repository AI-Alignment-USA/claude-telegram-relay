/**
 * X (Twitter) API v2 Integration
 *
 * CMO: draft posts (Tier 2, CEO approval required before posting)
 * No agent can post without explicit CEO approval.
 *
 * Uses OAuth 1.0a User Context authentication:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 *
 * Free tier limit: 1,500 posts/month. Monthly counter prevents overages.
 */

import { createHmac, randomBytes } from "crypto";

const API_KEY = process.env.X_API_KEY || "";
const API_SECRET = process.env.X_API_SECRET || "";
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET || "";

const TWEETS_API = "https://api.twitter.com/2/tweets";
const UPLOAD_API = "https://upload.twitter.com/1.1/media/upload.json";
const MONTHLY_LIMIT = 1500;

// ============================================================
// MONTHLY POST COUNTER
// ============================================================

let postCounter = { month: -1, year: -1, count: 0 };

function getCurrentMonth(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getUTCMonth(), year: now.getUTCFullYear() };
}

function getMonthlyCount(): number {
  const { month, year } = getCurrentMonth();
  if (postCounter.month !== month || postCounter.year !== year) {
    postCounter = { month, year, count: 0 };
  }
  return postCounter.count;
}

function incrementCounter(): void {
  const { month, year } = getCurrentMonth();
  if (postCounter.month !== month || postCounter.year !== year) {
    postCounter = { month, year, count: 1 };
  } else {
    postCounter.count++;
  }
}

export function getPostsRemaining(): number {
  return MONTHLY_LIMIT - getMonthlyCount();
}

// ============================================================
// OAUTH 1.0a SIGNATURE
// ============================================================

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(API_SECRET)}&${percentEncode(ACCESS_TOKEN_SECRET)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function buildAuthHeader(method: string, url: string, extraParams: Record<string, string> = {}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...extraParams };
  const signature = generateOAuthSignature(method, url, allParams);
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ============================================================
// CONFIG & HEALTH
// ============================================================

export function isConfigured(): boolean {
  return !!(API_KEY && API_SECRET && ACCESS_TOKEN && ACCESS_TOKEN_SECRET);
}

export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    // Verify credentials with a lightweight v2 /users/me call
    const url = "https://api.twitter.com/2/users/me";
    const auth = buildAuthHeader("GET", url);
    const res = await fetch(url, {
      headers: { Authorization: auth },
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// TYPES
// ============================================================

export interface TweetResult {
  id: string;
  text: string;
}

export interface MediaUploadResult {
  mediaId: string;
}

// ============================================================
// POST TWEET
// ============================================================

/**
 * Post a text tweet. ONLY call after CEO approval (Tier 2).
 * Checks monthly limit before posting.
 */
// Tracks the last error status for callers that need to distinguish failure types
export let lastPostError: number | null = null;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export async function postTweet(text: string): Promise<TweetResult | null> {
  lastPostError = null;

  if (!isConfigured()) {
    console.error("Twitter not configured");
    return null;
  }

  if (getMonthlyCount() >= MONTHLY_LIMIT) {
    console.error(`Twitter monthly limit reached (${MONTHLY_LIMIT} posts). Post blocked.`);
    return null;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const auth = buildAuthHeader("POST", TWEETS_API);
      const res = await fetch(TWEETS_API, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const data = await res.json();
        incrementCounter();
        lastPostError = null;
        return { id: data.data.id, text: data.data.text };
      }

      lastPostError = res.status;
      const body = await res.text();
      console.error(`Twitter postTweet error (attempt ${attempt}/${MAX_RETRIES}):`, res.status, body);

      // Retry on 503, fail immediately on other errors
      if (res.status !== 503 || attempt === MAX_RETRIES) {
        return null;
      }

      console.log(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } catch (e: any) {
      console.error(`Twitter postTweet error (attempt ${attempt}/${MAX_RETRIES}):`, e.message);
      lastPostError = 0;
      if (attempt === MAX_RETRIES) return null;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  return null;
}

// ============================================================
// POST TWEET WITH MEDIA
// ============================================================

/**
 * Upload an image and post a tweet with it. ONLY call after CEO approval (Tier 2).
 * Uses v1.1 media upload (required) + v2 tweet creation.
 *
 * @param text - Tweet text
 * @param imageBuffer - Image file contents as Buffer
 * @param mimeType - e.g. "image/png", "image/jpeg"
 */
export async function postTweetWithMedia(
  text: string,
  imageBuffer: Buffer,
  mimeType: string = "image/png"
): Promise<TweetResult | null> {
  if (!isConfigured()) {
    console.error("Twitter not configured");
    return null;
  }

  if (getMonthlyCount() >= MONTHLY_LIMIT) {
    console.error(`Twitter monthly limit reached (${MONTHLY_LIMIT} posts). Post blocked.`);
    return null;
  }

  try {
    // Step 1: Upload media via v1.1 multipart
    const mediaId = await uploadMedia(imageBuffer, mimeType);
    if (!mediaId) return null;

    // Step 2: Post tweet with media_ids
    const auth = buildAuthHeader("POST", TWEETS_API);
    const res = await fetch(TWEETS_API, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        media: { media_ids: [mediaId] },
      }),
    });

    if (!res.ok) {
      console.error("Twitter postTweetWithMedia error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    incrementCounter();
    return { id: data.data.id, text: data.data.text };
  } catch (e: any) {
    console.error("Twitter postTweetWithMedia error:", e.message);
    return null;
  }
}

async function uploadMedia(imageBuffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const boundary = `----BunBoundary${randomBytes(8).toString("hex")}`;

    // Build multipart form body manually
    const parts: Uint8Array[] = [];
    const encoder = new TextEncoder();

    // media_data field (base64)
    parts.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_data"\r\n\r\n`
    ));
    parts.push(encoder.encode(imageBuffer.toString("base64")));
    parts.push(encoder.encode("\r\n"));

    // media_category field
    parts.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_category"\r\n\r\ntweet_image\r\n`
    ));

    parts.push(encoder.encode(`--${boundary}--\r\n`));

    // Concatenate all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    const auth = buildAuthHeader("POST", UPLOAD_API);
    const res = await fetch(UPLOAD_API, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      console.error("Twitter media upload error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return data.media_id_string;
  } catch (e: any) {
    console.error("Twitter media upload error:", e.message);
    return null;
  }
}

// ============================================================
// DELETE TWEET
// ============================================================

/**
 * Delete a tweet by ID.
 */
export async function deleteTweet(tweetId: string): Promise<boolean> {
  if (!isConfigured()) {
    console.error("Twitter not configured");
    return false;
  }

  try {
    const url = `${TWEETS_API}/${tweetId}`;
    const auth = buildAuthHeader("DELETE", url);
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: auth },
    });

    if (!res.ok) {
      console.error("Twitter deleteTweet error:", res.status, await res.text());
      return false;
    }

    return true;
  } catch (e: any) {
    console.error("Twitter deleteTweet error:", e.message);
    return false;
  }
}

// ============================================================
// FORMATTERS
// ============================================================

export function formatTweetResult(result: TweetResult): string {
  return `Posted tweet (ID: ${result.id}): "${result.text}"`;
}

export function formatPostLimit(): string {
  const used = getMonthlyCount();
  const remaining = MONTHLY_LIMIT - used;
  return `X/Twitter posts this month: ${used}/${MONTHLY_LIMIT} (${remaining} remaining)`;
}

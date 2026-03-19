/**
 * Gmail API Integration
 *
 * CMO: draft emails (Tier 2, CEO approval required before sending)
 * CFO: read invoice and payment notification emails
 * No agent can send email without explicit CEO approval.
 *
 * Uses the same OAuth credentials as calendar.ts:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * Token scopes: gmail.readonly, gmail.send (already authorized)
 */

import { logIntegrationCall } from "./integration-logger.ts";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

let cachedAccessToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;

  if (cachedAccessToken && Date.now() < cachedAccessToken.expires - 60000) {
    return cachedAccessToken.token;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("Gmail OAuth error:", await res.text());
      return null;
    }

    const data = await res.json();
    cachedAccessToken = {
      token: data.access_token,
      expires: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  } catch (e: any) {
    console.error("Gmail token refresh failed:", e.message);
    return null;
  }
}

export function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

// ============================================================
// TYPES
// ============================================================

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
  labels: string[];
}

export interface DraftEmailInput {
  to: string;
  subject: string;
  body: string; // plain text or HTML
  html?: boolean;
}

export interface DraftEmailResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

export interface SendResult {
  messageId: string;
  threadId: string;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

function encodeBase64Url(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getHeader(headers: any[], name: string): string {
  const header = headers.find(
    (h: any) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

function buildRawMessage(input: DraftEmailInput, fromAddress: string): string {
  const contentType = input.html
    ? "text/html; charset=utf-8"
    : "text/plain; charset=utf-8";

  const raw = [
    `From: ${fromAddress}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Content-Type: ${contentType}`,
    ``,
    input.body,
  ].join("\r\n");

  return encodeBase64Url(raw);
}

function parseMessage(msg: any): GmailMessage {
  const headers = msg.payload?.headers || [];
  let body = "";

  // Extract body from parts or directly
  if (msg.payload?.body?.data) {
    body = decodeBase64Url(msg.payload.body.data);
  } else if (msg.payload?.parts) {
    // Prefer plain text, fall back to HTML
    const textPart = msg.payload.parts.find(
      (p: any) => p.mimeType === "text/plain"
    );
    const htmlPart = msg.payload.parts.find(
      (p: any) => p.mimeType === "text/html"
    );
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      body = decodeBase64Url(part.body.data);
    }
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    snippet: msg.snippet || "",
    body,
    labels: msg.labelIds || [],
  };
}

// ============================================================
// CFO: READ — Search and read emails
// ============================================================

/**
 * Search emails by query (Gmail search syntax).
 * Returns message metadata and snippets, not full bodies.
 */
export async function searchEmails(
  query: string,
  maxResults: number = 10
): Promise<GmailMessage[]> {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
    });

    const listRes = await fetch(`${GMAIL_API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!listRes.ok) {
      await logIntegrationCall("gmail", "system", "messages/search", "error", `${listRes.status}`);
      console.error("Gmail search error:", listRes.status);
      return [];
    }

    const listData = await listRes.json();
    const messageIds = (listData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      await logIntegrationCall("gmail", "system", "messages/search", "success");
      return [];
    }

    // Fetch each message with metadata
    const messages: GmailMessage[] = [];
    for (const id of messageIds) {
      const msgRes = await fetch(
        `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();
      messages.push(parseMessage(msg));
    }

    await logIntegrationCall("gmail", "system", "messages/search", "success");
    return messages;
  } catch (e: any) {
    await logIntegrationCall("gmail", "system", "messages/search", "error", e.message);
    console.error("Gmail searchEmails error:", e.message);
    return [];
  }
}

/**
 * Read a full email by message ID (includes body).
 */
export async function readEmail(messageId: string): Promise<GmailMessage | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      await logIntegrationCall("gmail", "system", "messages/get", "error", `${res.status}`);
      console.error("Gmail readEmail error:", res.status);
      return null;
    }

    await logIntegrationCall("gmail", "system", "messages/get", "success");
    return parseMessage(await res.json());
  } catch (e: any) {
    await logIntegrationCall("gmail", "system", "messages/get", "error", e.message);
    console.error("Gmail readEmail error:", e.message);
    return null;
  }
}

/**
 * CFO convenience: search for invoice and payment emails.
 */
export async function getInvoiceEmails(daysBack: number = 7): Promise<GmailMessage[]> {
  const after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  return searchEmails(
    `(subject:invoice OR subject:receipt OR subject:payment OR subject:"payment received" OR from:gumroad OR from:stripe OR from:paypal) after:${after}`,
    15
  );
}

// ============================================================
// CMO: WRITE — Draft and send emails (Tier 2)
// ============================================================

/**
 * Create a draft email. Does NOT send it.
 * Sending requires explicit CEO approval via the Tier 2 workflow.
 */
export async function createDraft(input: DraftEmailInput): Promise<DraftEmailResult | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    // Get the user's email address for the From header
    const profileRes = await fetch(`${GMAIL_API}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profile = await profileRes.json();
    const fromAddress = profile.emailAddress || "";

    const raw = buildRawMessage(input, fromAddress);

    const res = await fetch(`${GMAIL_API}/drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    });

    if (!res.ok) {
      await logIntegrationCall("gmail", "system", "drafts/create", "error", `${res.status}`);
      console.error("Gmail createDraft error:", res.status, await res.text());
      return null;
    }

    await logIntegrationCall("gmail", "system", "drafts/create", "success");
    const draft = await res.json();
    return {
      draftId: draft.id,
      messageId: draft.message?.id || "",
      threadId: draft.message?.threadId || "",
    };
  } catch (e: any) {
    await logIntegrationCall("gmail", "system", "drafts/create", "error", e.message);
    console.error("Gmail createDraft error:", e.message);
    return null;
  }
}

/**
 * Send a previously created draft. ONLY call this after CEO approval.
 * This is the only function that sends email; no other path exists.
 */
export async function sendDraft(draftId: string): Promise<SendResult | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${GMAIL_API}/drafts/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: draftId }),
    });

    if (!res.ok) {
      await logIntegrationCall("gmail", "system", "drafts/send", "error", `${res.status}`);
      console.error("Gmail sendDraft error:", res.status, await res.text());
      return null;
    }

    await logIntegrationCall("gmail", "system", "drafts/send", "success");
    const sent = await res.json();
    return {
      messageId: sent.id || "",
      threadId: sent.threadId || "",
    };
  } catch (e: any) {
    await logIntegrationCall("gmail", "system", "drafts/send", "error", e.message);
    console.error("Gmail sendDraft error:", e.message);
    return null;
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Ping the Gmail API. Returns status for dashboard health check.
 */
export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    const token = await getAccessToken();
    if (!token) return "error";

    const res = await fetch(`${GMAIL_API}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// FORMATTERS
// ============================================================

export function formatEmailList(emails: GmailMessage[]): string {
  if (emails.length === 0) return "No emails found.";

  return emails
    .map((e) => {
      const date = e.date
        ? new Date(e.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "America/Los_Angeles",
          })
        : "Unknown";
      const from = e.from.replace(/<[^>]+>/g, "").trim();
      return `- ${date}: "${e.subject}" from ${from}`;
    })
    .join("\n");
}

export function formatInvoiceSummary(emails: GmailMessage[]): string {
  if (emails.length === 0) return "No invoice or payment emails found.";

  const lines = [`${emails.length} invoice/payment email(s):`];
  for (const e of emails.slice(0, 10)) {
    const date = e.date
      ? new Date(e.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "America/Los_Angeles",
        })
      : "";
    const from = e.from.replace(/<[^>]+>/g, "").trim();
    lines.push(`  - ${date}: ${e.subject} (${from})`);
  }
  return lines.join("\n");
}

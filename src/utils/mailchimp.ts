/**
 * Mailchimp API integration for CMO
 *
 * Required env vars:
 *   MAILCHIMP_API_KEY
 *   MAILCHIMP_SERVER_PREFIX (e.g., us21)
 *   MAILCHIMP_LIST_ID (audience/list ID)
 *
 * To set up:
 *   1. Go to mailchimp.com > Account > API Keys
 *   2. Create a key. The server prefix is the part after the dash (e.g., us21)
 *   3. Get your list ID from Audience > Settings > Audience name and defaults
 */

const API_KEY = process.env.MAILCHIMP_API_KEY || "";
const SERVER = process.env.MAILCHIMP_SERVER_PREFIX || "";
const LIST_ID = process.env.MAILCHIMP_LIST_ID || "";

function baseUrl(): string {
  return `https://${SERVER}.api.mailchimp.com/3.0`;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

export function isConfigured(): boolean {
  return !!(API_KEY && SERVER);
}

export interface AudienceStats {
  memberCount: number;
  openRate: number;
  clickRate: number;
}

export async function getAudienceStats(): Promise<AudienceStats | null> {
  if (!isConfigured() || !LIST_ID) return null;

  try {
    const res = await fetch(`${baseUrl()}/lists/${LIST_ID}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      memberCount: data.stats?.member_count || 0,
      openRate: data.stats?.open_rate || 0,
      clickRate: data.stats?.click_rate || 0,
    };
  } catch {
    return null;
  }
}

export interface CampaignInfo {
  id: string;
  title: string;
  status: string;
  sendTime: string;
  opens: number;
  clicks: number;
  recipients: number;
}

export async function getRecentCampaigns(count: number = 5): Promise<CampaignInfo[]> {
  if (!isConfigured()) return [];

  try {
    const res = await fetch(
      `${baseUrl()}/campaigns?count=${count}&sort_field=send_time&sort_dir=DESC`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();

    return (data.campaigns || []).map((c: any) => ({
      id: c.id,
      title: c.settings?.subject_line || c.settings?.title || "Untitled",
      status: c.status,
      sendTime: c.send_time || "",
      opens: c.report_summary?.opens || 0,
      clicks: c.report_summary?.clicks || 0,
      recipients: c.recipients?.recipient_count || 0,
    }));
  } catch {
    return [];
  }
}

export async function createDraftCampaign(opts: {
  subject: string;
  previewText: string;
  htmlContent: string;
}): Promise<{ id: string; webId: string } | null> {
  if (!isConfigured() || !LIST_ID) return null;

  try {
    // Create campaign
    const createRes = await fetch(`${baseUrl()}/campaigns`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        type: "regular",
        recipients: { list_id: LIST_ID },
        settings: {
          subject_line: opts.subject,
          preview_text: opts.previewText,
          from_name: "C.T. Moody",
          reply_to: process.env.MAILCHIMP_REPLY_TO || "",
        },
      }),
    });

    if (!createRes.ok) return null;
    const campaign = await createRes.json();

    // Set content
    await fetch(`${baseUrl()}/campaigns/${campaign.id}/content`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ html: opts.htmlContent }),
    });

    return { id: campaign.id, webId: campaign.web_id };
  } catch {
    return null;
  }
}

export function formatStats(stats: AudienceStats): string {
  return [
    `Subscribers: ${stats.memberCount}`,
    `Avg open rate: ${(stats.openRate * 100).toFixed(1)}%`,
    `Avg click rate: ${(stats.clickRate * 100).toFixed(1)}%`,
  ].join("\n");
}

export function formatCampaigns(campaigns: CampaignInfo[]): string {
  if (campaigns.length === 0) return "No campaigns found";
  return campaigns
    .map((c) => {
      const date = c.sendTime
        ? new Date(c.sendTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "draft";
      return `- ${date}: "${c.title}" (${c.status}, ${c.opens} opens, ${c.clicks} clicks)`;
    })
    .join("\n");
}

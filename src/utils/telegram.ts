/**
 * Shared Telegram helpers
 * Used by both the relay and standalone workers
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";

export async function sendTelegram(
  message: string,
  options?: { parseMode?: "Markdown" | "HTML"; replyMarkup?: any }
): Promise<{ ok: boolean; messageId?: number }> {
  try {
    const body: any = {
      chat_id: CHAT_ID,
      text: message,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) return { ok: false };

    const data = await response.json();
    return { ok: true, messageId: data.result?.message_id };
  } catch {
    return { ok: false };
  }
}

export async function sendCostAlert(alerts: string[]): Promise<void> {
  if (alerts.length === 0) return;
  const message = `*Cost Alert*\n\n${alerts.join("\n")}`;
  await sendTelegram(message, { parseMode: "Markdown" });
}

/**
 * Send a photo to Telegram via the Bot API sendPhoto endpoint.
 * Used for sending shopping cart screenshots.
 */
export async function sendTelegramPhoto(
  photoPath: string,
  caption?: string
): Promise<{ ok: boolean; messageId?: number }> {
  try {
    const file = Bun.file(photoPath);
    const blob = new Blob([await file.arrayBuffer()]);

    const formData = new FormData();
    formData.append("chat_id", CHAT_ID);
    formData.append("photo", blob, "screenshot.png");
    if (caption) {
      formData.append("caption", stripEmDashes(caption));
      formData.append("parse_mode", "Markdown");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: formData }
    );

    if (!response.ok) {
      console.error("[telegram] sendPhoto failed:", await response.text());
      return { ok: false };
    }

    const data: any = await response.json();
    return { ok: true, messageId: data.result?.message_id };
  } catch (error) {
    console.error("[telegram] sendPhoto error:", error);
    return { ok: false };
  }
}

/**
 * Strip em dashes from text before it reaches Telegram.
 * Replaces em dashes (U+2014) and en dashes (U+2013) with regular hyphens.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/\u2014/g, "-").replace(/\u2013/g, "-");
}

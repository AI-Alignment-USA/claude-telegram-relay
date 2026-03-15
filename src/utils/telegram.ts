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

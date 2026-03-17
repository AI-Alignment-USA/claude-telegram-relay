/**
 * Voice Calling Integration — Twilio + ElevenLabs
 *
 * Converts text to speech via ElevenLabs, then places an outbound call
 * via Twilio that plays the generated audio.
 *
 * All agents can trigger a call but it requires Tier 2 approval (CEO must
 * approve before the call is placed), except CISO security alerts which
 * are Tier 1 (immediate).
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   CEO_PHONE_NUMBER
 *   ELEVENLABS_API_KEY (optional — falls back to Twilio <Say> TTS)
 */

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || "";
const CEO_PHONE = process.env.CEO_PHONE_NUMBER || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";

// Default ElevenLabs voice (Rachel — clear, professional)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const ELEVENLABS_MODEL = "eleven_monolingual_v1";

const TWILIO_API = "https://api.twilio.com/2010-04-01";
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

// ============================================================
// CONFIGURATION CHECKS
// ============================================================

export function isConfigured(): boolean {
  return !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_PHONE && CEO_PHONE);
}

export function isElevenLabsConfigured(): boolean {
  return !!ELEVENLABS_KEY;
}

// ============================================================
// TYPES
// ============================================================

export interface CallResult {
  callSid: string;
  status: string;
  to: string;
  from: string;
  provider: "elevenlabs+twilio" | "twilio";
}

// ============================================================
// ELEVENLABS TTS
// ============================================================

/**
 * Generate speech audio from text using ElevenLabs.
 * Returns a publicly accessible URL for the audio (base64 data URI
 * won't work with Twilio, so we upload to Twilio Assets or use
 * ElevenLabs streaming URL). Here we return the raw audio buffer
 * for use in TwiML <Play> via a base64 data approach or hosted URL.
 *
 * For Twilio integration, we generate TTS and host it as a Twilio
 * media resource, or fall back to Twilio's built-in <Say>.
 */
async function generateSpeech(text: string): Promise<Buffer | null> {
  if (!ELEVENLABS_KEY) return null;

  try {
    const res = await fetch(
      `${ELEVENLABS_API}/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!res.ok) {
      console.error(`ElevenLabs TTS error: ${res.status} ${res.statusText}`);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e: any) {
    console.error("ElevenLabs TTS error:", e.message);
    return null;
  }
}

// ============================================================
// TWILIO CALL
// ============================================================

function twilioAuth(): string {
  return "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
}

/**
 * Place an outbound call to the CEO phone number.
 *
 * If ElevenLabs is configured, generates TTS audio first.
 * The audio is hosted temporarily via a TwiML Bin-style inline approach:
 * we use Twilio's <Say> with SSML or <Play> with a hosted URL.
 *
 * For simplicity and reliability, we use Twilio's TwiML <Say> as the
 * primary method, with ElevenLabs enhancement when available via a
 * temporary media upload.
 */
export async function callCEO(
  agentName: string,
  message: string
): Promise<CallResult | null> {
  if (!isConfigured()) return null;

  try {
    // Build TwiML for the call
    let twiml: string;

    // Try ElevenLabs TTS first
    const audioBuffer = await generateSpeech(message);

    if (audioBuffer) {
      // Upload audio to Twilio as a media resource and play it
      const mediaUrl = await uploadTwilioMedia(audioBuffer);
      if (mediaUrl) {
        twiml =
          `<Response>` +
          `<Say voice="Polly.Joanna">Message from your ${agentName} agent.</Say>` +
          `<Pause length="1"/>` +
          `<Play>${mediaUrl}</Play>` +
          `<Pause length="1"/>` +
          `<Say voice="Polly.Joanna">End of message. Goodbye.</Say>` +
          `</Response>`;
      } else {
        // Fallback to Twilio TTS
        twiml = buildSayTwiml(agentName, message);
      }
    } else {
      // No ElevenLabs — use Twilio's built-in TTS
      twiml = buildSayTwiml(agentName, message);
    }

    // Place the call
    const form = new URLSearchParams();
    form.set("To", CEO_PHONE);
    form.set("From", TWILIO_PHONE);
    form.set("Twiml", twiml);

    const res = await fetch(
      `${TWILIO_API}/Accounts/${TWILIO_SID}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuth(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Twilio call error: ${res.status} ${errBody}`);
      return null;
    }

    const data = await res.json();
    return {
      callSid: data.sid,
      status: data.status,
      to: data.to,
      from: data.from,
      provider: audioBuffer ? "elevenlabs+twilio" : "twilio",
    };
  } catch (e: any) {
    console.error("Voice call error:", e.message);
    return null;
  }
}

/**
 * Build TwiML using Twilio's built-in <Say> (fallback when ElevenLabs
 * is unavailable).
 */
function buildSayTwiml(agentName: string, message: string): string {
  // Escape XML special characters
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return (
    `<Response>` +
    `<Say voice="Polly.Joanna">Message from your ${agentName} agent.</Say>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Joanna">${escaped}</Say>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Joanna">End of message. Goodbye.</Say>` +
    `</Response>`
  );
}

/**
 * Upload audio buffer to Twilio as a temporary media resource.
 * Returns a URL that Twilio can play in a call.
 */
async function uploadTwilioMedia(audio: Buffer): Promise<string | null> {
  try {
    // Use Twilio's Media resource on the account
    const form = new FormData();
    const blob = new Blob([audio], { type: "audio/mpeg" });
    form.append("MediaUrl", "data:audio/mpeg;base64," + audio.toString("base64"));

    // Alternative: host via a simple base64 data URI won't work with Twilio.
    // Instead, we create a temporary TwiML bin or use Twilio's recording storage.
    // For now, we use a workaround: write to a temp file and serve it.
    // In production, use Twilio Assets or an S3 bucket.

    // Write audio to a temp file that the dashboard server can serve
    const { writeFile } = await import("fs/promises");
    const { join, dirname } = await import("path");
    const tempDir = join(dirname(dirname(import.meta.path)), "dashboard", "public");
    const { mkdir } = await import("fs/promises");
    await mkdir(tempDir, { recursive: true });

    const filename = `call-audio-${Date.now()}.mp3`;
    const filepath = join(tempDir, filename);
    await writeFile(filepath, audio);

    // Return the URL served by the dashboard
    // The dashboard serves static files from dashboard/public/
    const dashboardPort = process.env.DASHBOARD_PORT || "3456";
    const tailscaleHost = process.env.TAILSCALE_HOSTNAME;

    if (tailscaleHost) {
      return `https://${tailscaleHost}:${dashboardPort}/public/${filename}`;
    }

    // Local fallback — Twilio needs a publicly accessible URL
    // In production, upload to S3/Cloudflare R2 instead
    console.warn("Voice: No TAILSCALE_HOSTNAME set; ElevenLabs audio may not be accessible to Twilio");
    return null;
  } catch (e: any) {
    console.error("Upload Twilio media error:", e.message);
    return null;
  }
}

// ============================================================
// CALL STATUS
// ============================================================

/**
 * Check the status of an existing call by SID.
 */
export async function getCallStatus(callSid: string): Promise<any | null> {
  if (!isConfigured()) return null;

  try {
    const res = await fetch(
      `${TWILIO_API}/Accounts/${TWILIO_SID}/Calls/${callSid}.json`,
      {
        headers: { Authorization: twilioAuth() },
      }
    );

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Verify Twilio credentials by fetching the account info.
 */
export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    const res = await fetch(
      `${TWILIO_API}/Accounts/${TWILIO_SID}.json`,
      {
        headers: { Authorization: twilioAuth() },
      }
    );
    if (!res.ok) return "error";
    const data = await res.json();
    return data.status === "active" ? "ok" : "error";
  } catch {
    return "error";
  }
}

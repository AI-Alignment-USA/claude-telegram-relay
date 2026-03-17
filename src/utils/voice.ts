/**
 * Voice Calling Integration — Twilio + ElevenLabs Conversational AI
 *
 * Two-way conversational AI calls:
 *   1. Twilio places outbound call to CEO
 *   2. Call audio streams via WebSocket to a local bridge server
 *   3. Bridge server connects to ElevenLabs Conversational AI WebSocket
 *   4. ElevenLabs handles STT + LLM processing + TTS in real-time
 *   5. CEO can ask follow-up questions and have a natural conversation
 *
 * Falls back to one-way TTS if Conversational AI is unavailable.
 *
 * All agents can trigger a call but it requires Tier 2 approval (CEO must
 * approve before the call is placed), except CISO security alerts which
 * are Tier 1 (immediate).
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   CEO_PHONE_NUMBER
 *   ELEVENLABS_API_KEY (for Conversational AI + TTS fallback)
 *   VOICE_WS_PORT (optional, default 8765)
 */

import { getAgent } from "../agents/registry.ts";
import {
  getOrCreateAgent,
  getSignedAgentUrl,
  VOICE_MAP,
  isConfigured as isElevenLabsApiConfigured,
} from "./elevenlabs-agents.ts";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || "";
const CEO_PHONE = process.env.CEO_PHONE_NUMBER || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";

const TWILIO_API = "https://api.twilio.com/2010-04-01";
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
const WS_PORT = parseInt(process.env.VOICE_WS_PORT || "8765");

// Public URL for Twilio to reach our WebSocket bridge.
// Priority: NGROK_URL (full URL) > VOICE_WS_HOST (hostname:port) > TAILSCALE_HOSTNAME
const NGROK_URL = process.env.NGROK_URL || "";
const WS_PUBLIC_HOST = process.env.VOICE_WS_HOST || process.env.TAILSCALE_HOSTNAME || "";

/**
 * Build the publicly accessible WebSocket URL for Twilio Media Streams.
 * ngrok terminates TLS and forwards to our local WS_PORT, so we use
 * wss://ngrok-domain/path (no port needed — ngrok handles it).
 */
function getPublicWsBaseUrl(): string {
  if (NGROK_URL) {
    // Convert https://foo.ngrok-free.dev to wss://foo.ngrok-free.dev
    return NGROK_URL.replace(/^https?:\/\//, "wss://").replace(/\/$/, "");
  }
  if (WS_PUBLIC_HOST) {
    return `wss://${WS_PUBLIC_HOST}:${WS_PORT}`;
  }
  return "";
}

function hasPublicWsUrl(): boolean {
  return !!(NGROK_URL || WS_PUBLIC_HOST);
}

// ============================================================
// CONFIGURATION CHECKS
// ============================================================

export function isConfigured(): boolean {
  return !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_PHONE && CEO_PHONE);
}

export function isElevenLabsConfigured(): boolean {
  return !!ELEVENLABS_KEY;
}

export function isConversationalAIReady(): boolean {
  return isConfigured() && isElevenLabsApiConfigured() && hasPublicWsUrl();
}

// ============================================================
// TYPES
// ============================================================

export interface CallResult {
  callSid: string;
  status: string;
  to: string;
  from: string;
  provider: "conversational-ai" | "elevenlabs-tts" | "twilio-tts";
  mode: "two-way" | "one-way";
}

// ============================================================
// ACTIVE CALL TRACKING
// ============================================================

interface ActiveCall {
  callSid: string;
  agentId: string;
  elevenLabsAgentId: string;
  startedAt: number;
  streamSid?: string;
}

const activeCalls = new Map<string, ActiveCall>();

export function getActiveCalls(): ActiveCall[] {
  return Array.from(activeCalls.values());
}

export function getActiveCallCount(): number {
  return activeCalls.size;
}

// ============================================================
// TWILIO MEDIA STREAM WEBSOCKET BRIDGE SERVER
// ============================================================

let wsServerStarted = false;

/**
 * Start the WebSocket bridge server that connects Twilio Media Streams
 * to ElevenLabs Conversational AI.
 *
 * Flow per call:
 *   Twilio --[mulaw audio]--> Bridge --[PCM16]--> ElevenLabs
 *   ElevenLabs --[PCM16 audio]--> Bridge --[mulaw]--> Twilio
 */
export function startMediaStreamServer(): void {
  if (wsServerStarted) return;
  wsServerStarted = true;

  const server = Bun.serve({
    port: WS_PORT,
    hostname: "0.0.0.0",
    fetch(req, server) {
      const url = new URL(req.url);

      // Twilio sends HTTP POST to get TwiML, then upgrades to WebSocket
      if (url.pathname === "/media-stream" && req.headers.get("upgrade") === "websocket") {
        const agentId = url.searchParams.get("agent") || "coo";
        const elAgentId = url.searchParams.get("el_agent_id") || "";
        const success = server.upgrade(req, { data: { agentId, elAgentId } });
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // Health check
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", activeCalls: activeCalls.size }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      async open(ws) {
        const { agentId, elAgentId } = ws.data as { agentId: string; elAgentId: string };
        console.log(`[voice-bridge] Twilio WebSocket connected for agent: ${agentId}`);

        // Connect to ElevenLabs Conversational AI WebSocket
        try {
          const signedUrl = await getSignedAgentUrl(elAgentId);
          const elWs = new WebSocket(signedUrl);

          // Store ElevenLabs WS on the Twilio WS for message routing
          (ws as any)._elWs = elWs;
          (ws as any)._agentId = agentId;
          (ws as any)._streamSid = null;

          elWs.onopen = () => {
            console.log(`[voice-bridge] ElevenLabs Conversational AI connected for ${agentId}`);

            // Initialize the conversation with audio format config
            elWs.send(JSON.stringify({
              type: "conversation_initiation_client_data",
              conversation_config_override: {
                agent: {
                  prompt: { prompt: "" }, // Uses the agent's configured prompt
                },
                tts: {
                  output_format: "ulaw_8000", // Twilio's native format
                },
              },
            }));
          };

          elWs.onmessage = (event) => {
            try {
              const msg = JSON.parse(typeof event.data === "string" ? event.data : "");

              if (msg.type === "audio") {
                // ElevenLabs sends audio chunks -> forward to Twilio
                const streamSid = (ws as any)._streamSid;
                if (streamSid && msg.audio?.chunk) {
                  ws.send(JSON.stringify({
                    event: "media",
                    streamSid,
                    media: {
                      payload: msg.audio.chunk, // base64 mulaw audio
                    },
                  }));
                }
              } else if (msg.type === "agent_response") {
                console.log(`[voice-bridge] Agent ${agentId} said: ${msg.agent_response?.substring(0, 100)}`);
              } else if (msg.type === "user_transcript") {
                console.log(`[voice-bridge] CEO said: ${msg.user_transcript?.substring(0, 100)}`);
              } else if (msg.type === "conversation_initiation_metadata") {
                console.log(`[voice-bridge] Conversation initialized for ${agentId}`);
              }
            } catch {}
          };

          elWs.onerror = (err) => {
            console.error(`[voice-bridge] ElevenLabs WS error for ${agentId}:`, err);
          };

          elWs.onclose = () => {
            console.log(`[voice-bridge] ElevenLabs WS closed for ${agentId}`);
          };
        } catch (e: any) {
          console.error(`[voice-bridge] Failed to connect to ElevenLabs:`, e.message);
        }
      },

      message(ws, message) {
        try {
          const msg = JSON.parse(typeof message === "string" ? message : message.toString());

          if (msg.event === "start") {
            // Twilio stream started — save streamSid
            (ws as any)._streamSid = msg.start?.streamSid;
            const agentId = (ws as any)._agentId;
            const callSid = msg.start?.callSid || "";

            activeCalls.set(callSid, {
              callSid,
              agentId,
              elevenLabsAgentId: "",
              startedAt: Date.now(),
              streamSid: msg.start?.streamSid,
            });

            console.log(`[voice-bridge] Stream started: ${msg.start?.streamSid} (call: ${callSid})`);
          } else if (msg.event === "media") {
            // Forward Twilio audio to ElevenLabs
            const elWs = (ws as any)._elWs as WebSocket | undefined;
            if (elWs && elWs.readyState === WebSocket.OPEN && msg.media?.payload) {
              elWs.send(JSON.stringify({
                user_audio_chunk: msg.media.payload, // base64 mulaw audio from caller
              }));
            }
          } else if (msg.event === "stop") {
            // Call ended — clean up
            const elWs = (ws as any)._elWs as WebSocket | undefined;
            if (elWs) elWs.close();

            // Remove from active calls
            for (const [sid, call] of activeCalls) {
              if (call.streamSid === (ws as any)._streamSid) {
                activeCalls.delete(sid);
                break;
              }
            }

            console.log(`[voice-bridge] Stream stopped for ${(ws as any)._agentId}`);
          }
        } catch {}
      },

      close(ws) {
        const elWs = (ws as any)._elWs as WebSocket | undefined;
        if (elWs && elWs.readyState === WebSocket.OPEN) elWs.close();
        console.log(`[voice-bridge] Twilio WebSocket disconnected`);
      },
    },
  });

  console.log(`[voice-bridge] WebSocket bridge server listening on ws://0.0.0.0:${WS_PORT}`);
}

// ============================================================
// TWILIO CALL — TWO-WAY CONVERSATIONAL AI
// ============================================================

function twilioAuth(): string {
  return "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
}

/**
 * Place an outbound call to the CEO phone number with two-way
 * conversational AI. The agent will greet the CEO with the initial
 * message and then handle a natural conversation.
 *
 * Falls back to one-way TTS if Conversational AI is unavailable.
 */
export async function callCEO(
  agentName: string,
  message: string
): Promise<CallResult | null> {
  if (!isConfigured()) return null;

  // Map agent name to agent ID
  const agentId = agentName.toLowerCase() === "system" ? "coo" : agentName.toLowerCase();

  // Try two-way conversational AI first
  if (isConversationalAIReady()) {
    const result = await callCEOConversational(agentId, message);
    if (result) return result;
    console.warn("[voice] Conversational AI failed, falling back to one-way TTS");
  }

  // Fallback: one-way TTS
  return callCEOOneWay(agentName, message);
}

/**
 * Two-way conversational AI call via Twilio Media Streams + ElevenLabs.
 */
async function callCEOConversational(
  agentId: string,
  initialMessage: string
): Promise<CallResult | null> {
  try {
    // Ensure WebSocket bridge server is running
    startMediaStreamServer();

    // Get or create the ElevenLabs Conversational AI agent
    const agent = await getAgent(agentId);
    const systemPrompt = agent?.systemPrompt || `You are the ${agentId} assistant.`;
    const firstMessage = `Hello Crevita, this is your ${agent?.name || agentId} agent. ${initialMessage}`;

    const elAgentId = await getOrCreateAgent(agentId, systemPrompt, firstMessage);

    // Build TwiML that connects to our WebSocket bridge
    const wsBase = getPublicWsBaseUrl();
    const wsUrl = `${wsBase}/media-stream?agent=${encodeURIComponent(agentId)}&el_agent_id=${encodeURIComponent(elAgentId)}`;

    const twiml =
      `<Response>` +
      `<Connect>` +
      `<Stream url="${escapeXml(wsUrl)}">` +
      `<Parameter name="agentId" value="${escapeXml(agentId)}" />` +
      `</Stream>` +
      `</Connect>` +
      `</Response>`;

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
      console.error(`[voice] Twilio call error: ${res.status} ${errBody}`);
      return null;
    }

    const data = await res.json();
    return {
      callSid: data.sid,
      status: data.status,
      to: data.to,
      from: data.from,
      provider: "conversational-ai",
      mode: "two-way",
    };
  } catch (e: any) {
    console.error("[voice] Conversational AI call error:", e.message);
    return null;
  }
}

// ============================================================
// FALLBACK: ONE-WAY TTS CALL
// ============================================================

/**
 * One-way TTS call. Generates speech via ElevenLabs (or Twilio built-in)
 * and plays it as a one-directional message.
 */
async function callCEOOneWay(
  agentName: string,
  message: string
): Promise<CallResult | null> {
  try {
    let twiml: string;
    let provider: "elevenlabs-tts" | "twilio-tts" = "twilio-tts";

    // Try ElevenLabs TTS
    const audioBuffer = await generateSpeech(message);
    if (audioBuffer) {
      const mediaUrl = await uploadTwilioMedia(audioBuffer);
      if (mediaUrl) {
        twiml =
          `<Response>` +
          `<Say voice="Polly.Joanna">Message from your ${escapeXml(agentName)} agent.</Say>` +
          `<Pause length="1"/>` +
          `<Play>${escapeXml(mediaUrl)}</Play>` +
          `<Pause length="1"/>` +
          `<Say voice="Polly.Joanna">End of message. Goodbye.</Say>` +
          `</Response>`;
        provider = "elevenlabs-tts";
      } else {
        twiml = buildSayTwiml(agentName, message);
      }
    } else {
      twiml = buildSayTwiml(agentName, message);
    }

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
      console.error(`[voice] Twilio one-way call error: ${res.status} ${errBody}`);
      return null;
    }

    const data = await res.json();
    return {
      callSid: data.sid,
      status: data.status,
      to: data.to,
      from: data.from,
      provider,
      mode: "one-way",
    };
  } catch (e: any) {
    console.error("[voice] One-way call error:", e.message);
    return null;
  }
}

// ============================================================
// ELEVENLABS TTS (for one-way fallback)
// ============================================================

async function generateSpeech(text: string): Promise<Buffer | null> {
  if (!ELEVENLABS_KEY) return null;

  try {
    const res = await fetch(
      `${ELEVENLABS_API}/text-to-speech/21m00Tcm4TlvDq8ikWAM`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!res.ok) {
      console.error(`[voice] ElevenLabs TTS error: ${res.status}`);
      return null;
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    console.error("[voice] ElevenLabs TTS error:", e.message);
    return null;
  }
}

// ============================================================
// HELPERS
// ============================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSayTwiml(agentName: string, message: string): string {
  return (
    `<Response>` +
    `<Say voice="Polly.Joanna">Message from your ${escapeXml(agentName)} agent.</Say>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Joanna">${escapeXml(message)}</Say>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Joanna">End of message. Goodbye.</Say>` +
    `</Response>`
  );
}

async function uploadTwilioMedia(audio: Buffer): Promise<string | null> {
  try {
    const { writeFile, mkdir } = await import("fs/promises");
    const { join, dirname } = await import("path");
    const tempDir = join(dirname(dirname(import.meta.path)), "dashboard", "public");
    await mkdir(tempDir, { recursive: true });

    const filename = `call-audio-${Date.now()}.mp3`;
    const filepath = join(tempDir, filename);
    await writeFile(filepath, audio);

    const dashboardPort = process.env.DASHBOARD_PORT || "3456";
    const tailscaleHost = process.env.TAILSCALE_HOSTNAME;

    if (tailscaleHost) {
      return `https://${tailscaleHost}:${dashboardPort}/public/${filename}`;
    }

    console.warn("[voice] No TAILSCALE_HOSTNAME; ElevenLabs audio may not be accessible to Twilio");
    return null;
  } catch (e: any) {
    console.error("[voice] Upload media error:", e.message);
    return null;
  }
}

// ============================================================
// CALL STATUS
// ============================================================

export async function getCallStatus(callSid: string): Promise<any | null> {
  if (!isConfigured()) return null;

  try {
    const res = await fetch(
      `${TWILIO_API}/Accounts/${TWILIO_SID}/Calls/${callSid}.json`,
      { headers: { Authorization: twilioAuth() } }
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

export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    const res = await fetch(
      `${TWILIO_API}/Accounts/${TWILIO_SID}.json`,
      { headers: { Authorization: twilioAuth() } }
    );
    if (!res.ok) return "error";
    const data = await res.json();
    return data.status === "active" ? "ok" : "error";
  } catch {
    return "error";
  }
}

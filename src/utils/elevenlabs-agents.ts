/**
 * ElevenLabs Conversational AI Agent Management
 *
 * Creates and manages ElevenLabs Conversational AI agents, one per Tamille agent.
 * Each agent gets its own voice and system prompt for two-way phone conversations.
 *
 * Required env var: ELEVENLABS_API_KEY
 */

const API_KEY = process.env.ELEVENLABS_API_KEY || "";
const BASE_URL = "https://api.elevenlabs.io/v1";

export function isConfigured(): boolean {
  return !!API_KEY;
}

// ============================================================
// VOICE ASSIGNMENTS — ElevenLabs pre-made voice IDs
// ============================================================

export const VOICE_MAP: Record<string, { voiceId: string; voiceName: string }> = {
  coo:            { voiceId: "21m00Tcm4TlvDq8ikWAM", voiceName: "Rachel" },
  ciso:           { voiceId: "pNInz6obpgDQGcFmaJgB", voiceName: "Adam" },
  cio:            { voiceId: "IKne3meq5aSn9XLyUdCD", voiceName: "Charlie" },
  cfo:            { voiceId: "onwK4e9ZLuTAKqWW03F9", voiceName: "Daniel" },
  cmo:            { voiceId: "EXAVITQu4vr4xnSDxMaL", voiceName: "Bella" },
  "head-content": { voiceId: "MF3mGyEYCl7XYWbV9V6O", voiceName: "Elli" },
  "head-education": { voiceId: "EXAVITQu4vr4xnSDxMaL", voiceName: "Sarah" },
  "head-household": { voiceId: "AZnzlk1XvdvUeBnXmlld", voiceName: "Domi" },
  "head-newsroom": { voiceId: "ErXwobaYiN019PkySvjV", voiceName: "Antoni" },
  "head-wellness": { voiceId: "pFZP5JQG7iQjIQuC4Bku", voiceName: "Lily" },
};

// ============================================================
// TYPES
// ============================================================

export interface ConversationalAgent {
  agent_id: string;
  name: string;
  conversation_config: {
    agent: {
      prompt: {
        prompt: string;
      };
      first_message: string;
      language: string;
    };
    tts: {
      voice_id: string;
    };
  };
}

export interface AgentSummary {
  agent_id: string;
  name: string;
}

// ============================================================
// API HELPERS
// ============================================================

async function elevenLabsGet(endpoint: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: { "xi-api-key": API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${body}`);
  }
  return res.json();
}

async function elevenLabsPost(endpoint: string, body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${text}`);
  }
  return res.json();
}

async function elevenLabsPatch(endpoint: string, body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "PATCH",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${text}`);
  }
  return res.json();
}

// ============================================================
// AGENT CRUD
// ============================================================

/**
 * Create an ElevenLabs Conversational AI agent for a Tamille agent.
 */
export async function createConversationalAgent(opts: {
  agentId: string;
  name: string;
  systemPrompt: string;
  firstMessage: string;
}): Promise<AgentSummary> {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

  const voice = VOICE_MAP[opts.agentId];
  if (!voice) throw new Error(`No voice mapping for agent: ${opts.agentId}`);

  const data = await elevenLabsPost("convai/agents/create", {
    name: `Tamille-${opts.name}`,
    conversation_config: {
      agent: {
        prompt: {
          prompt: opts.systemPrompt,
        },
        first_message: opts.firstMessage,
        language: "en",
      },
      tts: {
        voice_id: voice.voiceId,
      },
    },
  });

  return {
    agent_id: data.agent_id,
    name: data.name || opts.name,
  };
}

/**
 * Update an existing ElevenLabs Conversational AI agent.
 */
export async function updateConversationalAgent(
  elevenLabsAgentId: string,
  opts: {
    systemPrompt?: string;
    firstMessage?: string;
    voiceId?: string;
  }
): Promise<void> {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

  const update: any = { conversation_config: {} };

  if (opts.systemPrompt || opts.firstMessage) {
    update.conversation_config.agent = {};
    if (opts.systemPrompt) {
      update.conversation_config.agent.prompt = { prompt: opts.systemPrompt };
    }
    if (opts.firstMessage) {
      update.conversation_config.agent.first_message = opts.firstMessage;
    }
  }

  if (opts.voiceId) {
    update.conversation_config.tts = { voice_id: opts.voiceId };
  }

  await elevenLabsPatch(`convai/agents/${elevenLabsAgentId}`, update);
}

/**
 * Get details of an ElevenLabs Conversational AI agent.
 */
export async function getConversationalAgent(elevenLabsAgentId: string): Promise<any> {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");
  return elevenLabsGet(`convai/agents/${elevenLabsAgentId}`);
}

/**
 * List all ElevenLabs Conversational AI agents.
 */
export async function listConversationalAgents(): Promise<AgentSummary[]> {
  if (!API_KEY) return [];

  try {
    const data = await elevenLabsGet("convai/agents");
    return (data.agents || []).map((a: any) => ({
      agent_id: a.agent_id,
      name: a.name,
    }));
  } catch (e: any) {
    console.error("ElevenLabs list agents error:", e.message);
    return [];
  }
}

/**
 * Get a signed URL for connecting to an ElevenLabs Conversational AI agent
 * via WebSocket. This is what gets passed to the Twilio <Connect><Stream>.
 */
export async function getSignedAgentUrl(elevenLabsAgentId: string): Promise<string> {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

  const data = await elevenLabsGet(
    `convai/conversation/get_signed_url?agent_id=${elevenLabsAgentId}`
  );
  return data.signed_url;
}

// ============================================================
// AGENT ID CACHE — maps Tamille agent IDs to ElevenLabs agent IDs
// ============================================================

// In-memory cache: tamille agent id -> elevenlabs agent id
const agentIdCache = new Map<string, string>();

/**
 * Get or create the ElevenLabs Conversational AI agent for a Tamille agent.
 * Caches the mapping in memory. On first call for an agent, searches
 * existing ElevenLabs agents by name or creates a new one.
 */
export async function getOrCreateAgent(
  agentId: string,
  systemPrompt: string,
  firstMessage: string
): Promise<string> {
  // Check cache
  if (agentIdCache.has(agentId)) {
    return agentIdCache.get(agentId)!;
  }

  const voice = VOICE_MAP[agentId];
  const expectedName = `Tamille-${agentId}`;

  // Search existing agents
  const existing = await listConversationalAgents();
  const match = existing.find((a) => a.name === expectedName);

  if (match) {
    agentIdCache.set(agentId, match.agent_id);
    // Update system prompt in case it changed
    await updateConversationalAgent(match.agent_id, {
      systemPrompt,
      firstMessage,
      voiceId: voice?.voiceId,
    }).catch((e) => console.warn(`Failed to update agent ${agentId}:`, e.message));
    return match.agent_id;
  }

  // Create new agent
  const created = await createConversationalAgent({
    agentId,
    name: agentId,
    systemPrompt,
    firstMessage,
  });

  agentIdCache.set(agentId, created.agent_id);
  return created.agent_id;
}

// ============================================================
// HEALTH CHECK
// ============================================================

export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!API_KEY) return "not configured";

  try {
    await elevenLabsGet("convai/agents");
    return "ok";
  } catch {
    return "error";
  }
}

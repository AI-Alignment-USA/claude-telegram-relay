/**
 * Agent Registry
 * Loads agent configs from config/agents/*.md files
 * Each agent is a prompt context + model selection, not a class
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";

const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  modelDefault: string;
  modelEscalated: string;
  autonomyDefault: 1 | 2 | 3;
  systemPrompt: string;
  constraints: string[];
  reportsTo?: string;
}

// Static roster -- system prompts loaded from files at startup
const AGENT_DEFS: Omit<AgentConfig, "systemPrompt">[] = [
  {
    id: "coo",
    name: "Tamille",
    role: "Chief Operating Officer",
    modelDefault: "opus",
    modelEscalated: "opus",
    autonomyDefault: 1,
    constraints: [],
  },
  {
    id: "cio",
    name: "CIO",
    role: "Chief Information Officer",
    modelDefault: "sonnet",
    modelEscalated: "opus",
    autonomyDefault: 1,
    constraints: [],
  },
  {
    id: "cfo",
    name: "CFO",
    role: "Chief Financial Officer",
    modelDefault: "sonnet",
    modelEscalated: "opus",
    autonomyDefault: 1,
    constraints: [],
  },
  {
    id: "cmo",
    name: "CMO",
    role: "Chief Marketing Officer",
    modelDefault: "haiku",
    modelEscalated: "sonnet",
    autonomyDefault: 2,
    constraints: ["NEVER use em dashes in any content"],
    reportsTo: "coo",
  },
  {
    id: "head-content",
    name: "Head of Content",
    role: "Head of Content Production",
    modelDefault: "sonnet",
    modelEscalated: "opus",
    autonomyDefault: 2,
    constraints: ["NEVER use em dashes in any content"],
    reportsTo: "cmo",
  },
  {
    id: "head-education",
    name: "Head of Education",
    role: "Head of Education (Thomas's Support)",
    modelDefault: "haiku",
    modelEscalated: "haiku",
    autonomyDefault: 1,
    constraints: ["READ-ONLY: cannot communicate with anyone externally"],
  },
  {
    id: "head-household",
    name: "Head of Household",
    role: "Head of Household",
    modelDefault: "haiku",
    modelEscalated: "haiku",
    autonomyDefault: 2,
    constraints: [
      "EVERY co-parent message requires user approval",
      "OFW has no API - user pastes manually",
    ],
  },
  {
    id: "head-newsroom",
    name: "Head of News Room",
    role: "Head of News Room",
    modelDefault: "haiku",
    modelEscalated: "sonnet",
    autonomyDefault: 1,
    constraints: [],
  },
  {
    id: "head-wellness",
    name: "Head of Wellness",
    role: "Personal Confidant & Mental Health Check-in",
    modelDefault: "sonnet",
    modelEscalated: "opus",
    autonomyDefault: 3,
    constraints: [
      "NEVER share wellness conversation content with other agents",
      "ALL conversations are private, no COO review",
      "NEVER use em dashes in any output",
    ],
  },
  {
    id: "ciso",
    name: "CISO",
    role: "Chief Information Security Officer",
    modelDefault: "sonnet",
    modelEscalated: "opus",
    autonomyDefault: 1,
    constraints: [
      "Reports directly to Crevita, not through COO",
      "NEVER use em dashes in any output",
    ],
  },
  {
    id: "head-procurement",
    name: "Head of Procurement",
    role: "Head of Procurement (Shopping & Orders)",
    modelDefault: "sonnet",
    modelEscalated: "opus",
    autonomyDefault: 2,
    constraints: [
      "NEVER auto-purchase without explicit /approved from user",
      "NEVER use em dashes in any output",
    ],
  },
];

const agentCache = new Map<string, AgentConfig>();

async function loadSystemPrompt(agentId: string): Promise<string> {
  const promptPath = join(PROJECT_ROOT, "config", "agents", `${agentId}.md`);
  try {
    return await readFile(promptPath, "utf-8");
  } catch {
    return `You are the ${agentId} agent. Follow instructions from the user.`;
  }
}

export async function getAgent(id: string): Promise<AgentConfig | null> {
  if (agentCache.has(id)) return agentCache.get(id)!;

  const def = AGENT_DEFS.find((a) => a.id === id);
  if (!def) return null;

  const systemPrompt = await loadSystemPrompt(id);
  const agent: AgentConfig = { ...def, systemPrompt };
  agentCache.set(id, agent);
  return agent;
}

export function getAgentIds(): string[] {
  return AGENT_DEFS.map((a) => a.id);
}

export function getAllAgentDefs(): Omit<AgentConfig, "systemPrompt">[] {
  return AGENT_DEFS;
}

export function selectModel(
  agent: AgentConfig,
  taskType?: string
): string {
  // COO always uses Opus
  if (agent.id === "coo") return "opus";

  // Escalate for strategy, review, or sensitive tasks
  if (
    taskType === "strategy" ||
    taskType === "review" ||
    taskType === "sensitive"
  ) {
    return agent.modelEscalated;
  }

  return agent.modelDefault;
}

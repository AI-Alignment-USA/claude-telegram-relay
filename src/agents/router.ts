/**
 * Agent Router
 * Routes Telegram messages to the correct agent based on command prefixes
 */

import { getAgent, getAgentIds, type AgentConfig } from "./registry.ts";

export interface RouteResult {
  agent: AgentConfig;
  message: string;
  taskType?: string;
}

// Command prefix mapping
const COMMAND_MAP: Record<string, string> = {
  "/coo": "coo",
  "/tamille": "coo",
  "/cio": "cio",
  "/cfo": "cfo",
  "/cmo": "cmo",
  "/content": "head-content",
  "/education": "head-education",
  "/household": "head-household",
  "/news": "head-newsroom",
  "/newsroom": "head-newsroom",
};

// Workflow commands (handled separately from agent routing)
export const WORKFLOW_COMMANDS = ["/approve", "/reject", "/changes", "/status", "/costs"];

export function isWorkflowCommand(text: string): boolean {
  const cmd = text.split(" ")[0].toLowerCase();
  return WORKFLOW_COMMANDS.includes(cmd);
}

export function isAgentCommand(text: string): boolean {
  const cmd = text.split(" ")[0].toLowerCase();
  return cmd in COMMAND_MAP;
}

export async function routeMessage(text: string): Promise<RouteResult | null> {
  const parts = text.split(" ");
  const cmd = parts[0].toLowerCase();
  const message = parts.slice(1).join(" ").trim();

  const agentId = COMMAND_MAP[cmd];
  if (!agentId) return null;

  const agent = await getAgent(agentId);
  if (!agent) return null;

  return {
    agent,
    message: message || "What's my current status?",
  };
}

export function getHelpText(): string {
  const commands = Object.entries(COMMAND_MAP)
    .filter(([cmd]) => !cmd.startsWith("/tamille")) // skip alias
    .map(([cmd, id]) => `  ${cmd} - ${id}`)
    .join("\n");

  return (
    `*Agent Commands*\n\n${commands}\n\n` +
    `*Workflow Commands*\n` +
    `  /status - View agent status and pending tasks\n` +
    `  /costs - View today's cost breakdown\n` +
    `  /approve - View pending approvals\n\n` +
    `Send a message without a command prefix for general assistant.`
  );
}

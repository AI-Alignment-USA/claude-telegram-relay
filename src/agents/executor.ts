/**
 * Agent Executor
 * Wraps Claude CLI calls with agent-specific context, model selection, and cost tracking
 */

import { spawn } from "bun";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AgentConfig, selectModel } from "./registry.ts";
import { recordCost } from "../utils/cost.ts";
import { sendCostAlert } from "../utils/telegram.ts";

const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const PROJECT_DIR = process.env.PROJECT_DIR || "";
const USER_NAME = process.env.USER_NAME || "";
const USER_TIMEZONE =
  process.env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Load profile once
let profileContext = "";
try {
  profileContext = await readFile(
    join(PROJECT_ROOT, "config", "profile.md"),
    "utf-8"
  );
} catch {}

// Simple concurrency limiter
let activeCalls = 0;
const MAX_CONCURRENT = 2;
const waitQueue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT) {
    activeCalls++;
    return;
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCalls++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCalls--;
  const next = waitQueue.shift();
  if (next) next();
}

export interface ExecuteResult {
  response: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  costCents: number;
}

export async function executeAgent(
  agent: AgentConfig,
  userMessage: string,
  options?: {
    taskType?: string;
    supabase?: SupabaseClient | null;
    taskId?: string;
    additionalContext?: string;
  }
): Promise<ExecuteResult> {
  const model = selectModel(agent, options?.taskType);

  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Build the full prompt with agent context
  const promptParts = [
    agent.systemPrompt,
    "",
    `Current time: ${timeStr}`,
  ];

  if (USER_NAME) promptParts.push(`You are working for ${USER_NAME} (Founder and CEO).`);
  if (profileContext) promptParts.push(`\nUser Profile:\n${profileContext}`);

  if (agent.constraints.length > 0) {
    promptParts.push(`\nCONSTRAINTS (you MUST follow these):`);
    for (const c of agent.constraints) {
      promptParts.push(`- ${c}`);
    }
  }

  if (options?.additionalContext) {
    promptParts.push(`\n${options.additionalContext}`);
  }

  promptParts.push(`\nRequest: ${userMessage}`);

  const fullPrompt = promptParts.join("\n");

  // Build CLI args
  const args = [
    CLAUDE_PATH,
    "-p",
    fullPrompt,
    "--model",
    model,
    "--output-format",
    "json",
  ];

  console.log(`[${agent.id}] Calling Claude (${model}): ${userMessage.substring(0, 50)}...`);

  await acquireSlot();

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_DIR || undefined,
      env: { ...process.env },
    });

    const rawOutput = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[${agent.id}] Claude error:`, stderr);
      return {
        response: `Error: ${stderr || "Claude exited with code " + exitCode}`,
        inputTokens: 0,
        outputTokens: 0,
        model,
        costCents: 0,
      };
    }

    // Parse JSON output for response and token counts
    let response = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const parsed = JSON.parse(rawOutput);
      // Claude CLI JSON format: { result: string, ... }
      response = parsed.result || parsed.content || rawOutput;
      inputTokens = parsed.usage?.input_tokens || parsed.input_tokens || 0;
      outputTokens = parsed.usage?.output_tokens || parsed.output_tokens || 0;
    } catch {
      // If JSON parsing fails, treat as plain text
      response = rawOutput.trim();
    }

    // Record cost and check thresholds
    const { costCents, alerts } = await recordCost(
      options?.supabase || null,
      agent.id,
      model,
      inputTokens,
      outputTokens,
      options?.taskId
    );

    // Send cost alerts if any thresholds exceeded
    if (alerts.length > 0) {
      await sendCostAlert(alerts);
    }

    return { response, inputTokens, outputTokens, model, costCents };
  } finally {
    releaseSlot();
  }
}

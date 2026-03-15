/**
 * Cost tracking utilities
 * Token-to-dollar rates and threshold alerting
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// Rates per million tokens (USD)
const RATES: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.25, output: 1.25 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
};

// Alert thresholds in cents
export const THRESHOLDS = {
  DAILY_PER_AGENT: 200, // $2
  DAILY_TOTAL: 500, // $5
  WEEKLY_TOTAL: 1000, // $10
};

export function estimateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = RATES[model] || RATES.sonnet;
  const inputCost = (inputTokens / 1_000_000) * rate.input * 100;
  const outputCost = (outputTokens / 1_000_000) * rate.output * 100;
  return Math.round((inputCost + outputCost) * 10000) / 10000;
}

export async function recordCost(
  supabase: SupabaseClient | null,
  agentId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  taskId?: string
): Promise<{ costCents: number; alerts: string[] }> {
  const costCents = estimateCostCents(model, inputTokens, outputTokens);
  const alerts: string[] = [];

  if (!supabase) return { costCents, alerts };

  // Record the cost
  await supabase.from("cost_tracking").insert({
    agent_id: agentId,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_cents: costCents,
    task_id: taskId || null,
  });

  // Check daily per-agent threshold
  const { data: agentDaily } = await supabase.rpc("get_daily_costs");
  if (agentDaily) {
    for (const row of agentDaily) {
      if (row.agent_id === agentId && row.total_cents > THRESHOLDS.DAILY_PER_AGENT) {
        alerts.push(
          `Agent ${row.agent_name} has spent $${(row.total_cents / 100).toFixed(2)} today (threshold: $${(THRESHOLDS.DAILY_PER_AGENT / 100).toFixed(2)})`
        );
      }
    }

    // Check daily total threshold
    const dailyTotal = agentDaily.reduce(
      (sum: number, r: any) => sum + Number(r.total_cents),
      0
    );
    if (dailyTotal > THRESHOLDS.DAILY_TOTAL) {
      alerts.push(
        `Daily total spend: $${(dailyTotal / 100).toFixed(2)} (threshold: $${(THRESHOLDS.DAILY_TOTAL / 100).toFixed(2)})`
      );
    }
  }

  return { costCents, alerts };
}

export function formatCostReport(
  costs: Array<{ agent_id: string; agent_name: string; total_cents: number; call_count: number }>
): string {
  if (!costs || costs.length === 0) return "No costs recorded.";

  const lines = costs.map(
    (c) =>
      `  ${c.agent_name}: $${(Number(c.total_cents) / 100).toFixed(2)} (${c.call_count} calls)`
  );
  const total = costs.reduce((sum, c) => sum + Number(c.total_cents), 0);
  lines.push(`  Total: $${(total / 100).toFixed(2)}`);

  return lines.join("\n");
}

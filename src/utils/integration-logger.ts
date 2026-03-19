/**
 * Integration Health Logger
 *
 * Logs every external API call to the integration_health table.
 * Import and call logIntegrationCall() from each utility file.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export async function logIntegrationCall(
  integrationName: string,
  agentName: string,
  endpoint: string,
  status: "success" | "error",
  errorMessage?: string
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("integration_health").insert({
      integration_name: integrationName,
      agent_name: agentName,
      endpoint_called: endpoint,
      status,
      error_message: errorMessage || null,
    });
  } catch {
    // Silent — health logging should never break the caller
  }
}

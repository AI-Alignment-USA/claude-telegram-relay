/**
 * Command Center Dashboard
 *
 * Localhost-only web dashboard for the executive team.
 * Auth via DASHBOARD_TOKEN in .env.
 * Reads from Supabase directly.
 *
 * Run: bun run dashboard/server.ts
 * Docker: docker build -t dashboard ./dashboard && docker run -p 127.0.0.1:3000:3000 --env-file .env dashboard
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "fs/promises";
import { join } from "path";

const app = new Hono();
const PORT = parseInt(process.env.DASHBOARD_PORT || "3000");
const TOKEN = process.env.DASHBOARD_TOKEN || "tamille-dashboard-2026";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const VIEWS_DIR = join(import.meta.dir, "views");

async function renderView(name: string, data: Record<string, any> = {}): Promise<string> {
  let html = await readFile(join(VIEWS_DIR, `${name}.html`), "utf-8");
  // Simple template replacement: {{key}}
  for (const [key, value] of Object.entries(data)) {
    html = html.replaceAll(`{{${key}}}`, String(value));
  }
  return html;
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

app.use("*", async (c, next) => {
  // Allow static assets without auth
  if (c.req.path.startsWith("/static/")) {
    return next();
  }

  // Check for login page
  if (c.req.path === "/login") {
    return next();
  }

  // Check cookie or query param token
  const cookieToken = c.req.header("cookie")
    ?.split(";")
    .find((c) => c.trim().startsWith("token="))
    ?.split("=")[1]
    ?.trim();

  const queryToken = new URL(c.req.url).searchParams.get("token");

  if (cookieToken === TOKEN || queryToken === TOKEN) {
    if (queryToken === TOKEN && cookieToken !== TOKEN) {
      // Set cookie so they don't need token in URL again
      c.header("Set-Cookie", `token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
    }
    return next();
  }

  // Redirect to login
  return c.redirect("/login");
});

// ============================================================
// STATIC ASSETS
// ============================================================

app.use("/static/*", serveStatic({ root: join(import.meta.dir) }));

// ============================================================
// LOGIN
// ============================================================

app.get("/login", async (c) => {
  return c.html(await renderView("login", {}));
});

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const submitted = body.token as string;
  if (submitted === TOKEN) {
    c.header("Set-Cookie", `token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
    return c.redirect("/");
  }
  return c.html(await renderView("login", { error: "Invalid token" }));
});

// ============================================================
// OVERVIEW (home)
// ============================================================

app.get("/", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const [agents, dailyCosts, pendingApprovals, recentTasks] = await Promise.all([
    supabase.from("agents").select("*").eq("active", true).order("id"),
    supabase.rpc("get_daily_costs"),
    supabase.rpc("get_pending_approvals"),
    supabase
      .from("tasks")
      .select("id, agent_id, title, status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const totalCostCents = (dailyCosts.data || []).reduce(
    (s: number, r: any) => s + Number(r.total_cents), 0
  );

  return c.html(
    await renderView("overview", {
      agents: JSON.stringify(agents.data || []),
      dailyCosts: JSON.stringify(dailyCosts.data || []),
      pendingCount: (pendingApprovals.data || []).length,
      totalCostToday: (totalCostCents / 100).toFixed(2),
      recentTasks: JSON.stringify(recentTasks.data || []),
      taskCount: (recentTasks.data || []).length,
      completedCount: (recentTasks.data || []).filter((t: any) => t.status === "completed").length,
    })
  );
});

// ============================================================
// AGENT DETAIL
// ============================================================

app.get("/agent/:id", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);
  const agentId = c.req.param("id");

  const [agent, tasks, costs] = await Promise.all([
    supabase.from("agents").select("*").eq("id", agentId).single(),
    supabase
      .from("tasks")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("cost_tracking")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (!agent.data) return c.text("Agent not found", 404);

  const totalCostCents = (costs.data || []).reduce(
    (s: number, r: any) => s + Number(r.estimated_cost_cents), 0
  );

  return c.html(
    await renderView("agent", {
      agent: JSON.stringify(agent.data),
      agentName: agent.data.name,
      agentRole: agent.data.role,
      agentModel: agent.data.model_default,
      tasks: JSON.stringify(tasks.data || []),
      costs: JSON.stringify(costs.data || []),
      totalCost: (totalCostCents / 100).toFixed(2),
      taskCount: (tasks.data || []).length,
    })
  );
});

// ============================================================
// APPROVAL QUEUE
// ============================================================

app.get("/approvals", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const [pending, recent] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, agents(name, role)")
      .in("status", ["awaiting_approval", "awaiting_coo"])
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("*, agents(name, role)")
      .in("status", ["approved", "rejected", "changes_requested"])
      .order("updated_at", { ascending: false })
      .limit(15),
  ]);

  return c.html(
    await renderView("approvals", {
      pending: JSON.stringify(pending.data || []),
      recent: JSON.stringify(recent.data || []),
      pendingCount: (pending.data || []).length,
    })
  );
});

// Approval action API
app.post("/api/approve/:taskId", async (c) => {
  if (!supabase) return c.json({ error: "No DB" }, 500);
  const taskId = c.req.param("taskId");
  const body = await c.req.json();
  const action = body.action as string; // 'approved' | 'rejected'

  await supabase
    .from("tasks")
    .update({ status: action, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  await supabase
    .from("approvals")
    .update({ status: action, resolved_at: new Date().toISOString() })
    .eq("task_id", taskId);

  return c.json({ ok: true });
});

// ============================================================
// COSTS
// ============================================================

app.get("/costs", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const [daily, weekly, costHistory] = await Promise.all([
    supabase.rpc("get_daily_costs"),
    supabase.rpc("get_weekly_costs"),
    supabase
      .from("cost_tracking")
      .select("agent_id, model, estimated_cost_cents, created_at")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true }),
  ]);

  const dailyTotal = (daily.data || []).reduce(
    (s: number, r: any) => s + Number(r.total_cents), 0
  );
  const weeklyTotal = (weekly.data || []).reduce(
    (s: number, r: any) => s + Number(r.total_cents), 0
  );

  return c.html(
    await renderView("costs", {
      dailyCosts: JSON.stringify(daily.data || []),
      weeklyCosts: JSON.stringify(weekly.data || []),
      costHistory: JSON.stringify(costHistory.data || []),
      dailyTotal: (dailyTotal / 100).toFixed(2),
      weeklyTotal: (weeklyTotal / 100).toFixed(2),
    })
  );
});

// ============================================================
// NEWS ROOM
// ============================================================

app.get("/newsroom", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const category = new URL(c.req.url).searchParams.get("category");

  let query = supabase
    .from("news_items")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (category) {
    query = query.eq("category", category);
  }

  const { data } = await query;

  return c.html(
    await renderView("newsroom", {
      news: JSON.stringify(data || []),
      newsCount: (data || []).length,
      activeCategory: category || "all",
    })
  );
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", async (c) => {
  // PM2 service status
  let pm2Status: any[] = [];
  try {
    const { spawnSync } = await import("bun");
    const proc = spawnSync(["C:/Users/crevi/.bun/bin/pm2.exe", "jlist"]);
    const output = new TextDecoder().decode(proc.stdout);
    const processes = JSON.parse(output);
    pm2Status = processes.map((p: any) => ({
      name: p.name,
      status: p.pm2_env?.status || "unknown",
      uptime: p.pm2_env?.pm_uptime || 0,
      restarts: p.pm2_env?.restart_time || 0,
    }));
  } catch {}

  // Integration status
  const integrations: Record<string, string> = {};

  // Google Calendar
  const { isConfigured: calConfigured } = await import("../src/utils/calendar.ts");
  integrations.googleCalendar = calConfigured() ? "configured" : "not configured";

  // Mailchimp
  const { isConfigured: mcConfigured } = await import("../src/utils/mailchimp.ts");
  integrations.mailchimp = mcConfigured() ? "configured" : "not configured";

  // Gumroad
  integrations.gumroad = process.env.GUMROAD_ACCESS_TOKEN ? "configured" : "not configured";

  return c.json({
    status: "ok",
    supabase: !!supabase,
    services: pm2Status,
    integrations,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// START — bind to localhost + Tailscale only (never 0.0.0.0)
// ============================================================

const TAILSCALE_IP = process.env.TAILSCALE_IP || "";
const TAILSCALE_PORT = parseInt(process.env.TAILSCALE_PORT || String(PORT));

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: app.fetch,
});
console.log(`Dashboard listening on http://127.0.0.1:${PORT}`);

if (TAILSCALE_IP) {
  const tsPort = TAILSCALE_PORT === PORT ? PORT + 1 : TAILSCALE_PORT;
  try {
    Bun.serve({
      port: tsPort,
      hostname: TAILSCALE_IP,
      fetch: app.fetch,
    });
    console.log(`Dashboard listening on http://${TAILSCALE_IP}:${tsPort} (Tailscale)`);
  } catch (e: any) {
    console.error(`Tailscale bind failed (${TAILSCALE_IP}:${tsPort}): ${e.message}`);
  }
}

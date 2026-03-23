/**
 * Tamille Dashboard
 *
 * Localhost-only web dashboard for Tamille agent system.
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
// IP ALLOWLIST — localhost + Tailscale (100.x.x.x) only
// ============================================================

app.use("*", async (c, next) => {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = c.req.header("x-real-ip");
  const socketIp = (c.env as any)?.remoteAddress ?? (c.env as any)?.ip;
  const ip = forwarded || realIp || socketIp || "127.0.0.1";

  const isLocalhost = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const isTailscale = /^(::ffff:)?100\./.test(ip);

  if (!isLocalhost && !isTailscale) {
    console.warn(`[command-center] Blocked request from ${ip}`);
    return c.text("Forbidden", 403);
  }

  return next();
});

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
// WORKER DEFINITIONS (PM2 workers with metadata)
// ============================================================

const WORKER_DEFS: { id: string; name: string; desc: string; pm2Name: string; model: string; cron: string }[] = [
  { id: "ciso-patrol", name: "CISO Patrol", desc: "Nightly security sweep", pm2Name: "ciso-patrol", model: "sonnet", cron: "0 23 * * *" },
  { id: "ciso-brief", name: "CISO Brief", desc: "Morning security briefing", pm2Name: "ciso-brief", model: "sonnet", cron: "0 5 * * *" },
  { id: "ciso-weekly", name: "CISO Weekly", desc: "Weekly security posture report", pm2Name: "ciso-weekly", model: "sonnet", cron: "0 5 * * 1" },
  { id: "newsroom-collect", name: "Newsroom Collect", desc: "AI news collection from RSS feeds", pm2Name: "newsroom-collect", model: "haiku", cron: "0 7-21/2 * * *" },
  { id: "newsroom-daily", name: "Newsroom Daily", desc: "Daily AI news digest", pm2Name: "newsroom-daily-digest", model: "sonnet", cron: "0 5 * * *" },
  { id: "newsroom-weekly", name: "Newsroom Weekly", desc: "Weekly deep dive analysis", pm2Name: "newsroom-weekly-dive", model: "sonnet", cron: "0 9 * * 6" },
  { id: "cfo-daily", name: "CFO Daily", desc: "Daily sales and revenue report", pm2Name: "cfo-daily-report", model: "sonnet", cron: "0 5 * * *" },
  { id: "cfo-weekly", name: "CFO Weekly", desc: "Weekly financial summary", pm2Name: "cfo-weekly-report", model: "sonnet", cron: "0 19 * * 0" },
  { id: "coo-morning", name: "Morning Briefing", desc: "Daily morning overview", pm2Name: "coo-morning-briefing", model: "sonnet", cron: "0 5 * * *" },
  { id: "coo-eod", name: "EOD Summary", desc: "End of day wrap-up", pm2Name: "coo-eod-summary", model: "sonnet", cron: "0 20 * * *" },
  { id: "smart-checkin", name: "Smart Check-in", desc: "Context-aware proactive check-in", pm2Name: "claude-smart-checkin", model: "haiku", cron: "*/30 9-18 * * *" },
  { id: "education-digest", name: "Education Digest", desc: "Weekly education and STEM news", pm2Name: "education-digest", model: "sonnet", cron: "0 19 * * 0" },
  { id: "wellness-checkin", name: "Wellness Check-in", desc: "Midweek wellness pulse", pm2Name: "wellness-checkin", model: "sonnet", cron: "0 20 * * 3" },
  { id: "household-reminders", name: "Household Reminders", desc: "Daily household task reminders", pm2Name: "household-reminders", model: "haiku", cron: "0 8 * * *" },
  { id: "security-audit", name: "Security Audit", desc: "Weekly codebase security scan", pm2Name: "claude-security-audit", model: "sonnet", cron: "0 20 * * 0" },
  { id: "twitter-drafts", name: "Twitter Drafts", desc: "Daily tweet draft generation", pm2Name: "twitter-drafts", model: "sonnet", cron: "0 5 * * *" },
  { id: "memory-flush", name: "Memory Flush", desc: "Nightly knowledge extraction", pm2Name: "memory-flush", model: "haiku", cron: "0 23 * * *" },
];

async function getPm2Status(): Promise<Map<string, { status: string; lastRun: number | null }>> {
  const result = new Map<string, { status: string; lastRun: number | null }>();
  try {
    const { spawnSync } = await import("bun");
    const proc = spawnSync(["C:/Users/crevi/.bun/bin/pm2.exe", "jlist"]);
    const output = new TextDecoder().decode(proc.stdout);
    const processes = JSON.parse(output);
    for (const p of processes) {
      result.set(p.name, {
        status: p.pm2_env?.status || "unknown",
        lastRun: p.pm2_env?.pm_uptime || null,
      });
    }
  } catch {}
  return result;
}

// ============================================================
// OVERVIEW (home)
// ============================================================

app.get("/", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const [dailyCosts, weeklyCosts, pendingApprovals, recentTasks, pm2Status] = await Promise.all([
    supabase.rpc("get_daily_costs"),
    supabase.rpc("get_weekly_costs"),
    supabase.rpc("get_pending_approvals"),
    supabase
      .from("tasks")
      .select("id, agent_id, title, status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(20),
    getPm2Status(),
  ]);

  const totalCostCents = (dailyCosts.data || []).reduce(
    (s: number, r: any) => s + Number(r.total_cents), 0
  );
  const totalWeekCents = (weeklyCosts.data || []).reduce(
    (s: number, r: any) => s + Number(r.total_cents), 0
  );

  // Build workers array with PM2 status
  const workers = WORKER_DEFS.map((w) => {
    const pm2 = pm2Status.get(w.pm2Name);
    return {
      id: w.id,
      name: w.name,
      description: w.desc,
      model: w.model,
      cron: w.cron,
      status: pm2?.status || "stopped",
      lastRun: pm2?.lastRun || null,
    };
  });

  return c.html(
    await renderView("overview", {
      workers: JSON.stringify(workers),
      dailyCosts: JSON.stringify(dailyCosts.data || []),
      weeklyCosts: JSON.stringify(weeklyCosts.data || []),
      pendingCount: (pendingApprovals.data || []).length,
      totalCostToday: (totalCostCents / 100).toFixed(2),
      totalCostWeek: (totalWeekCents / 100).toFixed(2),
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

  // Privacy firewall: wellness agent details are not accessible
  if (agentId === "head-wellness") {
    return c.text("Wellness conversations are private. Status: Active.", 200);
  }

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
// MEETINGS
// ============================================================

app.get("/meetings", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const { data: meetings } = await supabase
    .from("meetings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  const meetingsList = meetings || [];
  const standups = meetingsList.filter((m: any) => m.type === "standup");
  const adhocs = meetingsList.filter((m: any) => m.type === "adhoc");
  const totalCostCents = meetingsList.reduce(
    (s: number, m: any) => s + (m.metadata?.total_cost_cents || 0), 0
  );

  return c.html(
    await renderView("meetings", {
      meetings: JSON.stringify(meetingsList),
      totalMeetings: meetingsList.length,
      standupCount: standups.length,
      adhocCount: adhocs.length,
      totalCost: (totalCostCents / 100).toFixed(2),
    })
  );
});

// Meeting detail API
app.get("/api/meeting/:id", async (c) => {
  if (!supabase) return c.json({ error: "No DB" }, 500);
  const id = c.req.param("id");
  const { data } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();
  return c.json(data || { error: "Not found" });
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
// SECURITY
// ============================================================

app.get("/security", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const [scores, inspections, secQuarantined] = await Promise.all([
    supabase.rpc("get_agent_posture_scores"),
    supabase.rpc("get_recent_inspections", { days_back: 7 }),
    supabase.from("agents").select("id, name, quarantine_reason").eq("quarantined", true),
  ]);

  const scoreData = scores.data || [];
  const inspectionData = inspections.data || [];
  const secQuarantinedData = (secQuarantined.data || []).map((a: any) => ({
    agent_id: a.id,
    agent_name: a.name,
    quarantine_reason: a.quarantine_reason,
  }));

  const validScores = scoreData.filter((s: any) => s.posture_score !== null);
  const avgScore = validScores.length > 0
    ? Math.round(validScores.reduce((s: number, r: any) => s + r.posture_score, 0) / validScores.length)
    : 0;
  const passedCount = inspectionData.filter((i: any) => i.passed).length;
  const failedCount = inspectionData.filter((i: any) => !i.passed).length;

  return c.html(
    await renderView("security", {
      scores: JSON.stringify(scoreData),
      inspections: JSON.stringify(inspectionData),
      quarantinedAgents: JSON.stringify(secQuarantinedData),
      avgScore: avgScore || "-",
      totalInspections: inspectionData.length,
      passedCount,
      failedCount,
      quarantinedCount: secQuarantinedData.length,
    })
  );
});

// ============================================================
// INTEGRATION HEALTH
// ============================================================

app.get("/integrations", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [allCalls, recentCalls] = await Promise.all([
    supabase
      .from("integration_health")
      .select("integration_name, status, error_message, created_at")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false }),
    supabase
      .from("integration_health")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const calls = allCalls.data || [];
  const totalCalls = calls.length;
  const errorCount = calls.filter((c: any) => c.status === "error").length;
  const successRate = totalCalls > 0 ? Math.round(((totalCalls - errorCount) / totalCalls) * 100) : 100;

  // Group by integration
  const byIntegration = new Map<string, any>();
  for (const call of calls) {
    const name = call.integration_name;
    if (!byIntegration.has(name)) {
      byIntegration.set(name, {
        integration_name: name,
        last_status: call.status,
        last_call: call.created_at,
        last_error: call.status === "error" ? call.error_message : null,
        total: 0,
        successes: 0,
      });
    }
    const entry = byIntegration.get(name)!;
    entry.total++;
    if (call.status === "success") entry.successes++;
  }

  return c.html(
    await renderView("integrations", {
      integrations: JSON.stringify(Array.from(byIntegration.values())),
      recentCalls: JSON.stringify(recentCalls.data || []),
      totalCalls,
      successRate,
      errorCount,
      integrationCount: byIntegration.size,
    })
  );
});

// ============================================================
// PRODUCT TRACKER
// ============================================================

app.get("/products", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  const list = products || [];
  const liveCount = list.filter((p: any) => p.status === "Live").length;
  const draftCount = list.filter((p: any) => p.status === "Draft").length;
  const blockedCount = list.filter((p: any) => p.status === "Blocked").length;

  return c.html(
    await renderView("products", {
      products: JSON.stringify(list),
      totalProducts: list.length,
      liveCount,
      draftCount,
      blockedCount,
    })
  );
});

// ============================================================
// CONTENT PIPELINE
// ============================================================

app.get("/content-pipeline", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const { data: content } = await supabase
    .from("content_pipeline")
    .select("*")
    .order("updated_at", { ascending: false });

  const list = content || [];
  const ideaCount = list.filter((c: any) => c.status === "Idea").length;
  const draftCount = list.filter((c: any) => c.status === "Draft").length;
  const publishedCount = list.filter((c: any) => c.status === "Published").length;

  return c.html(
    await renderView("content-pipeline", {
      content: JSON.stringify(list),
      totalContent: list.length,
      ideaCount,
      draftCount,
      publishedCount,
    })
  );
});

// ============================================================
// ISSUE TRACKER
// ============================================================

app.get("/issues", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const { data: issues } = await supabase
    .from("known_issues")
    .select("*")
    .order("created_at", { ascending: false });

  const list = issues || [];
  const openIssues = list.filter((i: any) => i.status !== "Fixed");
  const criticalCount = openIssues.filter((i: any) => i.severity === "Critical").length;
  const warningCount = openIssues.filter((i: any) => i.severity === "Warning").length;
  const openCount = openIssues.length;
  const fixedCount = list.filter((i: any) => i.status === "Fixed").length;

  return c.html(
    await renderView("issues", {
      issues: JSON.stringify(list),
      criticalCount,
      warningCount,
      openCount,
      fixedCount,
    })
  );
});

// Issue API for CISO auto-populate
app.post("/api/issues", async (c) => {
  if (!supabase) return c.json({ error: "No DB" }, 500);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from("known_issues")
    .insert({
      title: body.title,
      severity: body.severity || "Warning",
      assigned_agent: body.assigned_agent || "ciso",
      notes: body.notes || null,
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

// ============================================================
// TWEET DRAFTS
// ============================================================

app.get("/tweets", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);

  const { data: drafts } = await supabase
    .from("tasks")
    .select("id, title, status, metadata, created_at, completed_at")
    .eq("agent_id", "twitter-drafts")
    .order("created_at", { ascending: false })
    .limit(50);

  const list = (drafts || []).map((d: any) => ({
    id: d.id,
    content: d.metadata?.tweet_text || d.title || "",
    topic: d.metadata?.topic || "",
    status: d.status === "completed" ? "posted" :
      d.status === "approved" ? "approved" :
      d.status === "rejected" ? "rejected" : "pending",
    created_at: d.created_at,
  }));

  const pendingCount = list.filter((d: any) => d.status === "pending").length;
  const approvedCount = list.filter((d: any) => d.status === "approved").length;
  const postedCount = list.filter((d: any) => d.status === "posted").length;

  return c.html(
    await renderView("tweets", {
      drafts: JSON.stringify(list),
      totalDrafts: list.length,
      pendingCount,
      approvedCount,
      postedCount,
    })
  );
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", async (c) => {
  // PM2 service status
  const pm2Map = await getPm2Status();
  const pm2Status = Array.from(pm2Map.entries()).map(([name, info]) => ({
    name,
    status: info.status,
    uptime: info.lastRun || 0,
    restarts: 0,
  }));

  // Integration status
  const integrations: Record<string, string> = {};

  // Google Calendar (live API check)
  const { checkStatus: calCheck } = await import("../src/utils/calendar.ts");
  integrations.googleCalendar = await calCheck();

  // Mailchimp
  const { isConfigured: mcConfigured } = await import("../src/utils/mailchimp.ts");
  integrations.mailchimp = mcConfigured() ? "configured" : "not configured";

  // Gmail (live API check)
  const { checkStatus: gmailCheck } = await import("../src/utils/gmail.ts");
  integrations.gmail = await gmailCheck();

  // Gumroad (live API check)
  const { checkStatus: gumroadCheck } = await import("../src/utils/gumroad.ts");
  integrations.gumroad = await gumroadCheck();

  // HeyGen (live API check)
  const { checkStatus: heygenCheck } = await import("../src/utils/heygen.ts");
  integrations.heygen = await heygenCheck();

  // X/Twitter (live API check)
  const { checkStatus: twitterCheck, getPostsRemaining } = await import("../src/utils/twitter.ts");
  integrations.twitter = await twitterCheck();
  const twitterPostsRemaining = getPostsRemaining();

  // QuickBooks Online (live API check)
  const { checkStatus: qboCheck } = await import("../src/utils/quickbooks.ts");
  integrations.quickbooks = await qboCheck();

  // Voice Calling -- Twilio + ElevenLabs Conversational AI (live API check)
  const { checkStatus: voiceCheck, isElevenLabsConfigured, isConversationalAIReady: convAIReady, getActiveCallCount: activeCallCount } = await import("../src/utils/voice.ts");
  const { checkStatus: elAgentsCheck } = await import("../src/utils/elevenlabs-agents.ts");
  integrations.voice = await voiceCheck();
  integrations.voiceMode = convAIReady() ? "conversational-ai" : isElevenLabsConfigured() ? "one-way-tts" : "twilio-tts-only";
  integrations.elevenLabsAgents = await elAgentsCheck();
  const voiceActiveCalls = activeCallCount();

  return c.json({
    status: "ok",
    supabase: !!supabase,
    services: pm2Status,
    integrations,
    twitterPostsRemaining,
    voiceActiveCalls,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// START -- bind localhost + optionally Tailscale IP
// ============================================================

const TAILSCALE_IP = process.env.TAILSCALE_IP || "";

// Always serve on localhost
Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: app.fetch,
});
console.log(`Dashboard listening on http://127.0.0.1:${PORT}`);

// Attempt to also bind on the Tailscale IP for mobile access
if (TAILSCALE_IP) {
  console.log(`Tailscale IP from .env: ${TAILSCALE_IP}`);

  const tryTailscaleBind = (attempt: number) => {
    try {
      Bun.serve({
        port: PORT,
        hostname: TAILSCALE_IP,
        fetch: app.fetch,
      });
      console.log(`Dashboard also listening on http://${TAILSCALE_IP}:${PORT} (Tailscale)`);
    } catch (err: any) {
      if (attempt === 1) {
        console.warn(
          `[command-center] Tailscale bind to ${TAILSCALE_IP}:${PORT} failed (attempt ${attempt}), ` +
          `retrying in 3s... Error: ${err.message}`
        );
        setTimeout(() => tryTailscaleBind(2), 3000);
      } else {
        console.warn(
          `[command-center] Tailscale bind to ${TAILSCALE_IP}:${PORT} failed (attempt ${attempt}). ` +
          `Dashboard will serve on localhost only. Error: ${err.message}`
        );
      }
    }
  };

  tryTailscaleBind(1);
} else {
  console.warn("[command-center] TAILSCALE_IP not set in .env -- dashboard is localhost-only");
}

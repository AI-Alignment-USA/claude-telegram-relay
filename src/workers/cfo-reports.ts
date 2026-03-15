/**
 * CFO Reports Worker
 *
 * Daily: Gumroad sales snapshot (8am PT)
 * Weekly: Cost breakdown + revenue report (Sunday 7pm PT)
 *
 * Run: bun run src/workers/cfo-reports.ts [daily|weekly]
 */

import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../utils/telegram.ts";
import { formatCostReport } from "../utils/cost.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const GUMROAD_TOKEN = process.env.GUMROAD_ACCESS_TOKEN || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ============================================================
// GUMROAD
// ============================================================

interface SalesData {
  count: number;
  revenue: number;
  products: Record<string, { count: number; revenue: number }>;
}

async function getGumroadSales(daysBack: number = 1): Promise<SalesData | null> {
  if (!GUMROAD_TOKEN) return null;

  try {
    const after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const res = await fetch(
      `https://api.gumroad.com/v2/sales?access_token=${GUMROAD_TOKEN}&after=${after}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;

    const sales = data.sales || [];
    const products: Record<string, { count: number; revenue: number }> = {};

    for (const sale of sales) {
      const name = sale.product_name || "Unknown";
      if (!products[name]) products[name] = { count: 0, revenue: 0 };
      products[name].count++;
      products[name].revenue += sale.price / 100;
    }

    return {
      count: sales.length,
      revenue: sales.reduce((sum: number, s: any) => sum + s.price / 100, 0),
      products,
    };
  } catch {
    return null;
  }
}

// ============================================================
// REPORTS
// ============================================================

async function dailyReport(): Promise<void> {
  const sections = [`*[CFO] Daily Sales Report*`, ``];

  // Gumroad sales
  const sales = await getGumroadSales(1);
  if (sales === null) {
    sections.push(`*Gumroad*`, `Not configured (add GUMROAD_ACCESS_TOKEN to .env)`);
  } else if (sales.count === 0) {
    sections.push(`*Gumroad*`, `No sales today yet.`);
  } else {
    sections.push(`*Gumroad*`);
    sections.push(`${sales.count} sale(s), $${sales.revenue.toFixed(2)} revenue`);
    for (const [name, data] of Object.entries(sales.products)) {
      sections.push(`  - ${name}: ${data.count} sale(s), $${data.revenue.toFixed(2)}`);
    }
  }

  // Today's agent costs
  if (supabase) {
    const { data } = await supabase.rpc("get_daily_costs");
    if (data && data.length > 0) {
      sections.push(``, `*Agent Costs Today*`);
      sections.push(formatCostReport(data));
    } else {
      sections.push(``, `*Agent Costs Today*`, `No costs recorded yet.`);
    }
  }

  await sendTelegram(sections.join("\n"), { parseMode: "Markdown" });
}

async function weeklyReport(): Promise<void> {
  const sections = [`*[CFO] Weekly Financial Report*`, ``];

  // Weekly Gumroad sales
  const sales = await getGumroadSales(7);
  if (sales === null) {
    sections.push(`*Gumroad (7 days)*`, `Not configured`);
  } else {
    sections.push(`*Gumroad Revenue (7 days)*`);
    sections.push(`${sales.count} sale(s), $${sales.revenue.toFixed(2)} total`);
    if (Object.keys(sales.products).length > 0) {
      sections.push(`By product:`);
      for (const [name, data] of Object.entries(sales.products)) {
        sections.push(`  - ${name}: ${data.count} sale(s), $${data.revenue.toFixed(2)}`);
      }
    }
  }

  // Weekly agent costs
  if (supabase) {
    const { data } = await supabase.rpc("get_weekly_costs");
    if (data && data.length > 0) {
      sections.push(``, `*Agent Costs (7 days)*`);
      sections.push(formatCostReport(data));

      // Net calculation
      const totalCostCents = data.reduce(
        (sum: number, r: any) => sum + Number(r.total_cents),
        0
      );
      const revenue = sales?.revenue || 0;
      const net = revenue - totalCostCents / 100;
      sections.push(``, `*Net*`);
      sections.push(`Revenue: $${revenue.toFixed(2)}`);
      sections.push(`Agent costs: $${(totalCostCents / 100).toFixed(2)}`);
      sections.push(`Net: $${net.toFixed(2)}`);
    }
  }

  await sendTelegram(sections.join("\n"), { parseMode: "Markdown" });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const mode = process.argv[2] || "daily";

  if (mode === "weekly") {
    console.log("Building weekly financial report...");
    await weeklyReport();
    console.log("Weekly report sent.");
  } else {
    console.log("Building daily sales report...");
    await dailyReport();
    console.log("Daily report sent.");
  }
}

main();

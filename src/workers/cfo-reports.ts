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
import { guardTiming } from "../utils/timing-guard.ts";
import {
  isConfigured as gumroadConfigured,
  getSales,
  getProducts,
  formatSalesReport,
  formatProductPerformance,
} from "../utils/gumroad.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ============================================================
// REPORTS
// ============================================================

async function dailyReport(): Promise<void> {
  const sections = [`*[CFO] Daily Sales Report*`, ``];

  // Gumroad sales
  if (!gumroadConfigured()) {
    sections.push(`*Gumroad*`, `Not configured (add GUMROAD_ACCESS_TOKEN to .env)`);
  } else {
    const sales = await getSales(1);
    if (sales === null) {
      sections.push(`*Gumroad*`, `API error; check token.`);
    } else {
      sections.push(formatSalesReport(sales, "Gumroad (Today)"));
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
  let weeklyRevenue = 0;
  if (!gumroadConfigured()) {
    sections.push(`*Gumroad (7 days)*`, `Not configured`);
  } else {
    const sales = await getSales(7);
    if (sales === null) {
      sections.push(`*Gumroad (7 days)*`, `API error; check token.`);
    } else {
      weeklyRevenue = sales.revenue;
      sections.push(formatSalesReport(sales, "Gumroad Revenue (7 days)"));
    }

    // Product performance (lifetime stats)
    const products = await getProducts();
    if (products.length > 0) {
      sections.push(``, formatProductPerformance(products));
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
      const net = weeklyRevenue - totalCostCents / 100;
      sections.push(``, `*Net*`);
      sections.push(`Revenue: $${weeklyRevenue.toFixed(2)}`);
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
    guardTiming("cfo-weekly", { days: [0], earliest: "18:45", latest: "19:15" });
    console.log("Building weekly financial report...");
    await weeklyReport();
    console.log("Weekly report sent.");
  } else {
    guardTiming("cfo-daily", { earliest: "7:45", latest: "8:15" });
    console.log("Building daily sales report...");
    await dailyReport();
    console.log("Daily report sent.");
  }
}

main();

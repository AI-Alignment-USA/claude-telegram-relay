/**
 * QuickBooks Online API Integration
 *
 * CFO: read-only access (P&L, balance sheet, invoices, expenses, account balances)
 * No agent has write access. QuickBooks is strictly read-only.
 *
 * Uses OAuth 2.0 with auto-refreshing tokens:
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID
 *
 * QBO access tokens expire every hour; refresh tokens last 100 days.
 * On each refresh, the new refresh token is cached in memory.
 */

import { logIntegrationCall } from "./integration-logger.ts";

const CLIENT_ID = process.env.QBO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || "";
const REALM_ID = process.env.QBO_REALM_ID || "";

let refreshToken = process.env.QBO_REFRESH_TOKEN || "";
let cachedAccessToken: { token: string; expires: number } | null = null;

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASE = "https://quickbooks.api.intuit.com/v3/company";

// ============================================================
// OAUTH TOKEN MANAGEMENT
// ============================================================

async function getAccessToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken || !REALM_ID) return null;

  // Return cached token if still valid (60s buffer)
  if (cachedAccessToken && Date.now() < cachedAccessToken.expires - 60000) {
    return cachedAccessToken.token;
  }

  try {
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      console.error("QBO OAuth error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    cachedAccessToken = {
      token: data.access_token,
      expires: Date.now() + data.expires_in * 1000,
    };

    // QBO issues a new refresh token on each refresh; cache it
    if (data.refresh_token) {
      refreshToken = data.refresh_token;
    }

    return data.access_token;
  } catch (e: any) {
    console.error("QBO token refresh failed:", e.message);
    return null;
  }
}

// ============================================================
// CONFIG & HEALTH
// ============================================================

export function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && refreshToken && REALM_ID);
}

export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    const token = await getAccessToken();
    if (!token) return "error";

    // Lightweight call: fetch company info
    const res = await fetch(
      `${API_BASE}/${REALM_ID}/companyinfo/${REALM_ID}?minorversion=73`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

async function qboGet(endpoint: string): Promise<any> {
  const token = await getAccessToken();
  if (!token) throw new Error("QBO not authenticated");

  const res = await fetch(
    `${API_BASE}/${REALM_ID}/${endpoint}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    await logIntegrationCall("quickbooks", "system", endpoint, "error", `${res.status}: ${text}`);
    throw new Error(`QBO API ${res.status}: ${text}`);
  }

  await logIntegrationCall("quickbooks", "system", endpoint, "success");
  return res.json();
}

async function qboQuery(query: string): Promise<any[]> {
  const token = await getAccessToken();
  if (!token) throw new Error("QBO not authenticated");

  const url = `${API_BASE}/${REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=73`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    await logIntegrationCall("quickbooks", "system", "query", "error", `${res.status}: ${text}`);
    throw new Error(`QBO query error ${res.status}: ${text}`);
  }

  await logIntegrationCall("quickbooks", "system", "query", "success");
  const data = await res.json();
  const response = data.QueryResponse || {};
  // QBO returns the entity type as a key (e.g., "Invoice", "Purchase")
  const keys = Object.keys(response).filter((k) => k !== "startPosition" && k !== "maxResults" && k !== "totalCount");
  return keys.length > 0 ? response[keys[0]] || [] : [];
}

async function qboReport(reportName: string, params: Record<string, string> = {}): Promise<any> {
  const token = await getAccessToken();
  if (!token) throw new Error("QBO not authenticated");

  const url = new URL(`${API_BASE}/${REALM_ID}/reports/${reportName}`);
  url.searchParams.set("minorversion", "73");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    await logIntegrationCall("quickbooks", "system", `reports/${reportName}`, "error", `${res.status}: ${text}`);
    throw new Error(`QBO report error ${res.status}: ${text}`);
  }

  await logIntegrationCall("quickbooks", "system", `reports/${reportName}`, "success");
  return res.json();
}

// ============================================================
// TYPES
// ============================================================

export interface ReportRow {
  label: string;
  value: string;
}

export interface ProfitAndLoss {
  startDate: string;
  endDate: string;
  totalIncome: string;
  totalExpenses: string;
  netIncome: string;
  rows: ReportRow[];
}

export interface BalanceSheet {
  asOfDate: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  rows: ReportRow[];
}

export interface Invoice {
  id: string;
  customerName: string;
  date: string;
  dueDate: string;
  amount: number;
  balance: number;
  status: string;
}

export interface Expense {
  id: string;
  vendorName: string;
  date: string;
  amount: number;
  category: string;
  description: string;
}

export interface AccountBalance {
  name: string;
  type: string;
  balance: number;
}

// ============================================================
// REPORT PARSING HELPERS
// ============================================================

function extractReportRows(report: any): ReportRow[] {
  const rows: ReportRow[] = [];
  const reportRows = report?.Rows?.Row || [];

  for (const row of reportRows) {
    if (row.type === "Section" && row.Header) {
      const header = row.Header;
      const label = header.ColData?.[0]?.value || "";
      const value = header.ColData?.[1]?.value || "";
      if (label && value) rows.push({ label, value });

      // Process sub-rows
      for (const subRow of row.Rows?.Row || []) {
        if (subRow.type === "Data" && subRow.ColData) {
          const subLabel = subRow.ColData[0]?.value || "";
          const subValue = subRow.ColData[1]?.value || "";
          if (subLabel && subValue) rows.push({ label: `  ${subLabel}`, value: subValue });
        }
      }

      // Section summary
      if (row.Summary?.ColData) {
        const sumLabel = row.Summary.ColData[0]?.value || "";
        const sumValue = row.Summary.ColData[1]?.value || "";
        if (sumLabel && sumValue) rows.push({ label: sumLabel, value: sumValue });
      }
    } else if (row.type === "Data" && row.ColData) {
      const label = row.ColData[0]?.value || "";
      const value = row.ColData[1]?.value || "";
      if (label && value) rows.push({ label, value });
    }
  }

  return rows;
}

function findSummaryValue(report: any, labelPattern: string): string {
  const rows = report?.Rows?.Row || [];
  for (const row of rows) {
    if (row.Summary?.ColData) {
      const label = (row.Summary.ColData[0]?.value || "").toLowerCase();
      if (label.includes(labelPattern.toLowerCase())) {
        return row.Summary.ColData[1]?.value || "0.00";
      }
    }
    // Check group headers
    if (row.group && row.group.toLowerCase().includes(labelPattern.toLowerCase()) && row.Summary?.ColData) {
      return row.Summary.ColData[1]?.value || "0.00";
    }
  }
  return "0.00";
}

// ============================================================
// CFO: READ ACCESS
// ============================================================

/**
 * Get Profit & Loss report for a date range.
 * Defaults to current month.
 */
export async function getProfitAndLoss(
  startDate?: string,
  endDate?: string
): Promise<ProfitAndLoss | null> {
  if (!isConfigured()) return null;

  try {
    const now = new Date();
    const start = startDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const end = endDate || now.toISOString().split("T")[0];

    const report = await qboReport("ProfitAndLoss", {
      start_date: start,
      end_date: end,
    });

    return {
      startDate: start,
      endDate: end,
      totalIncome: findSummaryValue(report, "income") || findSummaryValue(report, "total income"),
      totalExpenses: findSummaryValue(report, "expense") || findSummaryValue(report, "total expense"),
      netIncome: findSummaryValue(report, "net income"),
      rows: extractReportRows(report),
    };
  } catch (e: any) {
    console.error("QBO getProfitAndLoss error:", e.message);
    return null;
  }
}

/**
 * Get Balance Sheet as of a specific date.
 * Defaults to today.
 */
export async function getBalanceSheet(asOfDate?: string): Promise<BalanceSheet | null> {
  if (!isConfigured()) return null;

  try {
    const date = asOfDate || new Date().toISOString().split("T")[0];

    const report = await qboReport("BalanceSheet", {
      date_macro: "", // clear macro to use explicit date
      start_date: date,
      end_date: date,
    });

    return {
      asOfDate: date,
      totalAssets: findSummaryValue(report, "asset"),
      totalLiabilities: findSummaryValue(report, "liabilit"),
      totalEquity: findSummaryValue(report, "equity"),
      rows: extractReportRows(report),
    };
  } catch (e: any) {
    console.error("QBO getBalanceSheet error:", e.message);
    return null;
  }
}

/**
 * Get recent invoices (last N days, default 30).
 */
export async function getRecentInvoices(daysBack: number = 30): Promise<Invoice[]> {
  if (!isConfigured()) return [];

  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const results = await qboQuery(
      `SELECT * FROM Invoice WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS 50`
    );

    return results.map((inv: any) => ({
      id: inv.Id,
      customerName: inv.CustomerRef?.name || "Unknown",
      date: inv.TxnDate || "",
      dueDate: inv.DueDate || "",
      amount: parseFloat(inv.TotalAmt || "0"),
      balance: parseFloat(inv.Balance || "0"),
      status: parseFloat(inv.Balance || "0") === 0 ? "Paid" : "Outstanding",
    }));
  } catch (e: any) {
    console.error("QBO getRecentInvoices error:", e.message);
    return [];
  }
}

/**
 * Get recent expenses/purchases (last N days, default 30).
 */
export async function getRecentExpenses(daysBack: number = 30): Promise<Expense[]> {
  if (!isConfigured()) return [];

  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const results = await qboQuery(
      `SELECT * FROM Purchase WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS 50`
    );

    return results.map((exp: any) => {
      const line = exp.Line?.[0] || {};
      const detail = line.AccountBasedExpenseLineDetail || {};
      return {
        id: exp.Id,
        vendorName: exp.EntityRef?.name || "Unknown",
        date: exp.TxnDate || "",
        amount: parseFloat(exp.TotalAmt || "0"),
        category: detail.AccountRef?.name || line.Description || "Uncategorized",
        description: line.Description || "",
      };
    });
  } catch (e: any) {
    console.error("QBO getRecentExpenses error:", e.message);
    return [];
  }
}

/**
 * Get all account balances (bank, credit card, etc.).
 */
export async function getAccountBalances(): Promise<AccountBalance[]> {
  if (!isConfigured()) return [];

  try {
    const results = await qboQuery(
      `SELECT * FROM Account WHERE Active = true ORDERBY AccountType`
    );

    return results.map((acct: any) => ({
      name: acct.Name || "Unknown",
      type: acct.AccountType || "Other",
      balance: parseFloat(acct.CurrentBalance || "0"),
    }));
  } catch (e: any) {
    console.error("QBO getAccountBalances error:", e.message);
    return [];
  }
}

// ============================================================
// FORMATTERS
// ============================================================

export function formatProfitAndLoss(pnl: ProfitAndLoss): string {
  const lines = [
    `*Profit & Loss (${pnl.startDate} to ${pnl.endDate})*`,
    `  Income: $${pnl.totalIncome}`,
    `  Expenses: $${pnl.totalExpenses}`,
    `  Net Income: $${pnl.netIncome}`,
  ];

  if (pnl.rows.length > 0) {
    lines.push("");
    for (const row of pnl.rows) {
      lines.push(`  ${row.label}: $${row.value}`);
    }
  }

  return lines.join("\n");
}

export function formatBalanceSheet(bs: BalanceSheet): string {
  return [
    `*Balance Sheet (as of ${bs.asOfDate})*`,
    `  Total Assets: $${bs.totalAssets}`,
    `  Total Liabilities: $${bs.totalLiabilities}`,
    `  Total Equity: $${bs.totalEquity}`,
  ].join("\n");
}

export function formatInvoices(invoices: Invoice[]): string {
  if (invoices.length === 0) return "No recent invoices.";

  const outstanding = invoices.filter((i) => i.status === "Outstanding");
  const paid = invoices.filter((i) => i.status === "Paid");
  const totalOutstanding = outstanding.reduce((s, i) => s + i.balance, 0);

  const lines = [
    `*Recent Invoices (${invoices.length})*`,
    `  Outstanding: ${outstanding.length} ($${totalOutstanding.toFixed(2)})`,
    `  Paid: ${paid.length}`,
  ];

  if (outstanding.length > 0) {
    lines.push("", "*Outstanding:*");
    for (const inv of outstanding) {
      lines.push(`  - ${inv.customerName}: $${inv.balance.toFixed(2)} (due ${inv.dueDate})`);
    }
  }

  return lines.join("\n");
}

export function formatExpenses(expenses: Expense[]): string {
  if (expenses.length === 0) return "No recent expenses.";

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byCategory: Record<string, number> = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }

  const lines = [
    `*Recent Expenses (${expenses.length}, $${total.toFixed(2)} total)*`,
  ];

  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, amt] of sorted) {
    lines.push(`  - ${cat}: $${amt.toFixed(2)}`);
  }

  return lines.join("\n");
}

export function formatAccountBalances(accounts: AccountBalance[]): string {
  if (accounts.length === 0) return "No accounts found.";

  const grouped: Record<string, AccountBalance[]> = {};
  for (const acct of accounts) {
    if (!grouped[acct.type]) grouped[acct.type] = [];
    grouped[acct.type].push(acct);
  }

  const lines = ["*Account Balances*"];
  for (const [type, accts] of Object.entries(grouped)) {
    lines.push(`  ${type}:`);
    for (const a of accts) {
      lines.push(`    - ${a.name}: $${a.balance.toFixed(2)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a full financial summary for CFO daily/weekly reports.
 * Combines P&L, account balances, outstanding invoices, and recent expenses.
 */
export async function getFinancialSummary(daysBack: number = 7): Promise<string> {
  if (!isConfigured()) return "QuickBooks not configured.";

  try {
    const [pnl, accounts, invoices, expenses] = await Promise.all([
      getProfitAndLoss(),
      getAccountBalances(),
      getRecentInvoices(daysBack),
      getRecentExpenses(daysBack),
    ]);

    const sections: string[] = ["*QuickBooks Financial Summary*", ""];

    if (pnl) sections.push(formatProfitAndLoss(pnl), "");
    if (accounts.length > 0) sections.push(formatAccountBalances(accounts), "");
    if (invoices.length > 0) sections.push(formatInvoices(invoices), "");
    if (expenses.length > 0) sections.push(formatExpenses(expenses));

    return sections.join("\n");
  } catch (e: any) {
    console.error("QBO getFinancialSummary error:", e.message);
    return "QuickBooks summary unavailable.";
  }
}

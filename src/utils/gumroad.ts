/**
 * Gumroad API Integration
 *
 * CFO: read access (sales, revenue, product performance)
 * CMO: write access (create draft product listings, Tier 2 approval to publish)
 *
 * Required env var: GUMROAD_ACCESS_TOKEN
 *
 * To set up:
 *   1. Go to gumroad.com/settings/advanced
 *   2. Under "Application", create an application or use your access token
 *   3. Add GUMROAD_ACCESS_TOKEN to .env
 */

import { logIntegrationCall } from "./integration-logger.ts";

const TOKEN = process.env.GUMROAD_ACCESS_TOKEN || "";
const BASE_URL = "https://api.gumroad.com/v2";

export function isConfigured(): boolean {
  return !!TOKEN;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

async function gumroadGet(endpoint: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set("access_token", TOKEN);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    await logIntegrationCall("gumroad", "system", endpoint, "error", `${res.status}: ${res.statusText}`);
    throw new Error(`Gumroad API ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.success) {
    await logIntegrationCall("gumroad", "system", endpoint, "error", JSON.stringify(data));
    throw new Error(`Gumroad API error: ${JSON.stringify(data)}`);
  }
  await logIntegrationCall("gumroad", "system", endpoint, "success");
  return data;
}

async function gumroadPost(endpoint: string, body: Record<string, any>): Promise<any> {
  const formData = new URLSearchParams();
  formData.set("access_token", TOKEN);
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) formData.set(k, String(v));
  }

  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
  if (!res.ok) {
    await logIntegrationCall("gumroad", "system", endpoint, "error", `${res.status}: ${res.statusText}`);
    throw new Error(`Gumroad API ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.success) {
    await logIntegrationCall("gumroad", "system", endpoint, "error", JSON.stringify(data));
    throw new Error(`Gumroad API error: ${JSON.stringify(data)}`);
  }
  await logIntegrationCall("gumroad", "system", endpoint, "success");
  return data;
}

async function gumroadPut(endpoint: string, body: Record<string, any>): Promise<any> {
  const formData = new URLSearchParams();
  formData.set("access_token", TOKEN);
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) formData.set(k, String(v));
  }

  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "PUT",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
  if (!res.ok) {
    await logIntegrationCall("gumroad", "system", endpoint, "error", `${res.status}: ${res.statusText}`);
    throw new Error(`Gumroad API ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.success) {
    await logIntegrationCall("gumroad", "system", endpoint, "error", JSON.stringify(data));
    throw new Error(`Gumroad API error: ${JSON.stringify(data)}`);
  }
  await logIntegrationCall("gumroad", "system", endpoint, "success");
  return data;
}

// ============================================================
// CFO: READ ACCESS — Sales & Revenue
// ============================================================

export interface SalesData {
  count: number;
  revenue: number;
  products: Record<string, { count: number; revenue: number }>;
}

/**
 * Get sales for the last N days. Paginates through all results.
 */
export async function getSales(daysBack: number = 1): Promise<SalesData | null> {
  if (!TOKEN) return null;

  try {
    const after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const allSales: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await gumroadGet("sales", { after, page: String(page) });
      const sales = data.sales || [];
      allSales.push(...sales);
      // Gumroad returns empty page when done
      hasMore = sales.length > 0 && page < 10; // safety cap
      page++;
    }

    const products: Record<string, { count: number; revenue: number }> = {};
    for (const sale of allSales) {
      const name = sale.product_name || "Unknown";
      if (!products[name]) products[name] = { count: 0, revenue: 0 };
      products[name].count++;
      products[name].revenue += sale.price / 100;
    }

    return {
      count: allSales.length,
      revenue: allSales.reduce((sum: number, s: any) => sum + s.price / 100, 0),
      products,
    };
  } catch (e: any) {
    console.error("Gumroad getSales error:", e.message);
    return null;
  }
}

export interface ProductInfo {
  id: string;
  name: string;
  price: number;
  currency: string;
  salesCount: number;
  salesRevenue: number;
  published: boolean;
  url: string;
  description: string;
}

/**
 * Get all products with performance data.
 */
export async function getProducts(): Promise<ProductInfo[]> {
  if (!TOKEN) return [];

  try {
    const data = await gumroadGet("products");
    return (data.products || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      price: p.price / 100,
      currency: p.currency || "usd",
      salesCount: p.sales_count || 0,
      salesRevenue: (p.sales_usd_cents || 0) / 100,
      published: p.published,
      url: p.short_url || "",
      description: (p.description || "").substring(0, 200),
    }));
  } catch (e: any) {
    console.error("Gumroad getProducts error:", e.message);
    return [];
  }
}

// ============================================================
// CMO: READ ACCESS — Product Details & Copy Review
// ============================================================

export interface ProductDetails {
  id: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  customSummary: string;
  published: boolean;
  url: string;
  shortUrl: string;
  salesCount: number;
  salesRevenue: number;
  customFields: string[];
  tags: string[];
}

/**
 * Get full product details including complete description and copy.
 * Used by CMO for product copy review and optimization.
 */
export async function getProductDetails(productId: string): Promise<ProductDetails | null> {
  if (!TOKEN) return null;

  try {
    const data = await gumroadGet(`products/${encodeURIComponent(productId)}`);
    const p = data.product;
    return {
      id: p.id,
      name: p.name,
      price: (p.price || 0) / 100,
      currency: p.currency || "usd",
      description: p.description || "",
      customSummary: p.custom_summary || "",
      published: p.published,
      url: p.url || "",
      shortUrl: p.short_url || "",
      salesCount: p.sales_count || 0,
      salesRevenue: (p.sales_usd_cents || 0) / 100,
      customFields: (p.custom_fields || []).map((f: any) => f.name),
      tags: p.tags || [],
    };
  } catch (e: any) {
    console.error("Gumroad getProductDetails error:", e.message);
    return null;
  }
}

// ============================================================
// CMO: WRITE ACCESS — Draft Product Listings
// ============================================================

export interface DraftProductInput {
  name: string;
  price: number; // in dollars
  description: string;
  url?: string; // custom permalink
}

export interface DraftProductResult {
  id: string;
  name: string;
  price: number;
  url: string;
}

/**
 * Create an unpublished (draft) product on Gumroad.
 * Publishing requires CEO approval via Tier 2 workflow.
 */
export async function createDraftProduct(input: DraftProductInput): Promise<DraftProductResult | null> {
  if (!TOKEN) return null;

  try {
    const data = await gumroadPost("products", {
      name: input.name,
      price: Math.round(input.price * 100), // Gumroad expects cents
      description: input.description,
      url: input.url || undefined,
      published: false, // always create as draft
    });

    const product = data.product;
    return {
      id: product.id,
      name: product.name,
      price: product.price / 100,
      url: product.short_url || "",
    };
  } catch (e: any) {
    console.error("Gumroad createDraftProduct error:", e.message);
    return null;
  }
}

/**
 * Publish a draft product (called after CEO approval).
 */
export async function publishProduct(productId: string): Promise<boolean> {
  if (!TOKEN) return false;

  try {
    await gumroadPut(`products/${productId}`, { published: true });
    return true;
  } catch (e: any) {
    console.error("Gumroad publishProduct error:", e.message);
    return false;
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Ping the Gumroad API. Returns status string for dashboard health check.
 */
export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!TOKEN) return "not configured";

  try {
    // Lightweight call: fetch user profile
    const res = await fetch(`${BASE_URL}/user?access_token=${TOKEN}`);
    if (!res.ok) return "error";
    const data = await res.json();
    return data.success ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// FORMATTERS
// ============================================================

export function formatSalesReport(sales: SalesData, label: string = "Gumroad"): string {
  if (sales.count === 0) return `*${label}*\nNo sales.`;

  const lines = [`*${label}*`, `${sales.count} sale(s), $${sales.revenue.toFixed(2)} revenue`];
  for (const [name, data] of Object.entries(sales.products)) {
    lines.push(`  - ${name}: ${data.count} sale(s), $${data.revenue.toFixed(2)}`);
  }
  return lines.join("\n");
}

export function formatProductPerformance(products: ProductInfo[]): string {
  if (products.length === 0) return "No products found.";

  const published = products.filter((p) => p.published);
  const drafts = products.filter((p) => !p.published);

  const lines: string[] = [];

  if (published.length > 0) {
    lines.push(`*Published Products (${published.length})*`);
    for (const p of published) {
      lines.push(`  - ${p.name}: $${p.price} | ${p.salesCount} sales | $${p.salesRevenue.toFixed(2)} revenue`);
    }
  }

  if (drafts.length > 0) {
    lines.push(`*Draft Products (${drafts.length})*`);
    for (const d of drafts) {
      lines.push(`  - ${d.name}: $${d.price} (unpublished)`);
    }
  }

  const totalRevenue = products.reduce((s, p) => s + p.salesRevenue, 0);
  const totalSales = products.reduce((s, p) => s + p.salesCount, 0);
  lines.push(`*Totals:* ${totalSales} sales, $${totalRevenue.toFixed(2)} lifetime revenue`);

  return lines.join("\n");
}

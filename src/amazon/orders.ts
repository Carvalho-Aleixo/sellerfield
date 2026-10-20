import type { Database } from "bun:sqlite";
import { Amazon, MARKETPLACE_US } from "./client";
import { cents, pacificDay } from "./time";

export type OrderRow = { order_id: string; sku: string; asin: string; title: string; day: string; units: number; item_sales_cents: number; status: "shipped" | "cancelled"; channel: "afn" | "mcf" | "vine" };

/**
 * Parse the flat-file orders report (tab separated, one row per order line).
 * Pending lines are skipped (no price yet; they come back on a later sync).
 * Sales = item price (the line total) minus the promotion discount.
 * Channel: `mcf` for multi-channel fulfilment (Non-Amazon sales channel or an `S01-` id), `vine` for a shipped line priced 0, else `afn` (a normal customer order).
 */
export function parseOrdersReport(text: string): OrderRow[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].split("\t");
  const rows = new Map<string, OrderRow>();
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const o = (k: string) => c[head.indexOf(k)] ?? "";
    const status = o("order-status");
    if (status === "Pending" || !o("sku")) continue;
    const cancelled = status === "Cancelled" || o("item-status") === "Cancelled";
    const sales = cents(o("item-price")) - cents(o("item-promotion-discount"));
    const id = o("amazon-order-id");
    const channel = o("sales-channel").startsWith("Non-Amazon") || id.startsWith("S01-") ? "mcf" : !cancelled && sales <= 0 ? "vine" : "afn";
    // One order can list a SKU on two lines; the table keeps one row per order and SKU, so add them up.
    const key = `${id}|${o("sku")}`;
    const prev = rows.get(key);
    const units = parseInt(o("quantity"), 10) || 0;
    if (prev) { prev.units += units; prev.item_sales_cents += sales; continue; }
    rows.set(key, { order_id: id, sku: o("sku"), asin: o("asin"), title: o("product-name"), day: pacificDay(o("purchase-date")), units, item_sales_cents: sales, status: cancelled ? "cancelled" : "shipped", channel });
  }
  return [...rows.values()];
}

/** Request, wait for and download the orders report for [start, end] (ISO timestamps, at most 30 days apart). */
export async function fetchOrdersReport(amazon: Amazon, start: string, end: string): Promise<string> {
  const { reportId } = await amazon.sp("POST", "/reports/2021-06-30/reports", {}, {
    reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL", marketplaceIds: [MARKETPLACE_US], dataStartTime: start, dataEndTime: end,
  });
  for (let i = 0; i < 90; i++) {
    const r = await amazon.sp("GET", `/reports/2021-06-30/reports/${reportId}`);
    if (r.processingStatus === "DONE") {
      const doc = await amazon.sp("GET", `/reports/2021-06-30/documents/${r.reportDocumentId}`);
      return amazon.download(doc.url);
    }
    if (r.processingStatus === "FATAL" || r.processingStatus === "CANCELLED") throw new Error(`orders report ${r.processingStatus}`);
    await amazon.pause(10_000);
  }
  throw new Error("orders report not ready after 15 minutes");
}

/** Insert or update orders and their products. Returns the number of order lines written. */
export function saveOrders(db: Database, rows: OrderRow[], accountId = 1): number {
  const order = db.query("INSERT OR REPLACE INTO orders (account_id, order_id, sku, day, units, item_sales_cents, status, channel) VALUES (?,?,?,?,?,?,?,?)");
  const product = db.query("INSERT INTO products (account_id, sku, asin, title) VALUES (?,?,?,?) ON CONFLICT (account_id, sku) DO UPDATE SET asin = excluded.asin, title = excluded.title");
  db.transaction(() => {
    for (const r of rows) {
      order.run(accountId, r.order_id, r.sku, r.day, r.units, r.item_sales_cents, r.status, r.channel);
      product.run(accountId, r.sku, r.asin, r.title || r.sku);
    }
  })();
  return rows.length;
}

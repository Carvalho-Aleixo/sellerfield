import type { Database } from "bun:sqlite";
import { Amazon } from "./amazon/client";
import { fetchOrdersReport, parseOrdersReport, saveOrders } from "./amazon/orders";
import { estimateFees, fetchFinancialEvents, saveFinances } from "./amazon/finances";
import { fetchAdSpend, saveAdSpend } from "./amazon/ads";
import { chunks, pacificDay } from "./amazon/time";

export type SyncResult = { source: string; status: "ok" | "error" | "skipped"; detail: string };

const DAY = 86_400_000;

/** Run `fn` as one sync_runs row; an error is recorded and returned, never thrown, so one source cannot stop the others. */
async function run(db: Database, source: string, fn: () => Promise<string>): Promise<SyncResult> {
  const id = Number(db.query("INSERT INTO sync_runs (source, started_at, status) VALUES (?, ?, 'running')").run(source, new Date().toISOString()).lastInsertRowid);
  let status: "ok" | "error" = "ok";
  let detail: string;
  try { detail = await fn(); } catch (e) { status = "error"; detail = e instanceof Error ? e.message : String(e); }
  db.query("UPDATE sync_runs SET finished_at=?, status=?, detail=? WHERE id=?").run(new Date().toISOString(), status, detail, id);
  return { source, status, detail };
}

/**
 * Pull the last `days` days from Amazon into the database: orders, then finances (with estimated fees for orders not yet charged), then ads.
 * Re-running is safe: orders are replaced by key, fee, refund and ad rows of the window are replaced.
 */
export async function sync(db: Database, amazon: Amazon, days = 30, now = new Date()): Promise<SyncResult[]> {
  const fromDay = pacificDay(new Date(now.getTime() - days * DAY).toISOString());
  const today = pacificDay(now.toISOString());
  const start = new Date(Date.parse(fromDay) - DAY).toISOString();
  const end = new Date(now.getTime() - 5 * 60_000).toISOString(); // Amazon refuses an end time in the last 2 minutes
  const results: SyncResult[] = [];

  results.push(await run(db, "orders", async () => {
    let n = 0;
    for (const c of chunks(start.slice(0, 10), end.slice(0, 10), 30)) {
      const from = c.from === start.slice(0, 10) ? start : `${c.from}T00:00:00Z`;
      const to = c.to === end.slice(0, 10) ? end : `${c.to}T23:59:59Z`;
      n += saveOrders(db, parseOrdersReport(await fetchOrdersReport(amazon, from, to)));
    }
    return `${n} order lines`;
  }));

  results.push(await run(db, "finances", async () => {
    const p = await fetchFinancialEvents(amazon, start, end);
    saveFinances(db, p, fromDay);
    const est = estimateFees(db, fromDay);
    return `${p.fees.length} fees, ${p.refunds.length} refunds, ${est} estimated fees`;
  }));

  if (!amazon.hasAds) results.push({ source: "ads", status: "skipped", detail: "no Ads API credentials (import the spend from the Ads console instead)" });
  else results.push(await run(db, "ads", async () => {
    const types = ["SP", "SD", "SB"] as const;
    const reports = await Promise.allSettled(types.map((type) => fetchAdSpend(amazon, type, fromDay, today))); // Amazon builds the three reports side by side
    let n = 0;
    const failed: string[] = [];
    reports.forEach((r, i) => {
      if (r.status === "fulfilled") { saveAdSpend(db, r.value, [types[i]], fromDay); n += r.value.length; }
      else failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    });
    if (failed.length) throw new Error(`${failed.join("; ")} (${n} rows saved from the other reports)`);
    return `${n} ad spend rows`;
  }));

  return results;
}

import type { Database } from "bun:sqlite";
import { Amazon } from "./client";
import { cents, pacificDay } from "./time";

export type Fee = { order_id: string | null; sku: string | null; day: string; kind: string; amount_cents: number };
export type Refund = { order_id: string; sku: string; day: string; refunded_cents: number; refunded_fees_cents: number };
export type Parsed = { fees: Fee[]; refunds: Refund[] };

const amount = (x: any) => cents(x?.CurrencyAmount);
const feeKind = (type: string) => (type === "Commission" ? "referral" : type.startsWith("FBA") ? "fba" : "other_order");

/**
 * Turn Finances API events (the `FinancialEvents` object of one or more pages) into fee and refund rows.
 * Amazon reports fees as negative numbers; here a positive amount is a cost to the seller.
 * Multi-channel (`S01-`) orders are dropped. Event types not listed here (ad charges, taxes, transfers) are ignored on purpose:
 * ad spend comes from the Ads API.
 * Service fee events carry no posting date, so they take `fallbackDay` (the day of the window they were fetched in).
 */
export function parseFinancialEvents(ev: any, fallbackDay: string): Parsed {
  const fees: Fee[] = [];
  const refunds: Refund[] = [];

  for (const s of ev.ShipmentEventList ?? []) {
    const order_id = s.AmazonOrderId as string;
    if (order_id?.startsWith("S01-")) continue;
    const day = pacificDay(s.PostedDate);
    for (const item of s.ShipmentItemList ?? [])
      for (const f of item.ItemFeeList ?? []) fees.push({ order_id, sku: item.SellerSKU, day, kind: feeKind(f.FeeType), amount_cents: -amount(f.FeeAmount) });
  }

  for (const s of ev.RefundEventList ?? []) {
    const order_id = s.AmazonOrderId as string;
    if (order_id?.startsWith("S01-")) continue;
    const day = pacificDay(s.PostedDate);
    for (const item of s.ShipmentItemAdjustmentList ?? []) {
      const principal = (item.ItemChargeAdjustmentList ?? []).filter((c: any) => c.ChargeType === "Principal").reduce((n: number, c: any) => n + amount(c.ChargeAmount), 0);
      const feeBack = (item.ItemFeeAdjustmentList ?? []).reduce((n: number, f: any) => n + amount(f.FeeAmount), 0);
      refunds.push({ order_id, sku: item.SellerSKU, day, refunded_cents: -principal, refunded_fees_cents: feeBack });
    }
  }

  for (const s of ev.ServiceFeeEventList ?? [])
    for (const f of s.FeeList ?? []) {
      const kind = /storage/i.test(f.FeeType) ? "storage" : /subscription/i.test(f.FeeType) ? "subscription" : "service";
      fees.push({ order_id: null, sku: null, day: s.PostedDate ? pacificDay(s.PostedDate) : fallbackDay, kind, amount_cents: -amount(f.FeeAmount) });
    }

  for (const a of ev.AdjustmentEventList ?? [])
    if (/REIMBURSEMENT/i.test(a.AdjustmentType ?? "")) fees.push({ order_id: null, sku: null, day: pacificDay(a.PostedDate), kind: "reimbursement", amount_cents: -amount(a.AdjustmentAmount) });

  return { fees, refunds };
}

/** All financial events posted from `postedAfter` until `postedBefore` (ISO timestamps), one UTC day at a time, page by page. */
export async function fetchFinancialEvents(amazon: Amazon, postedAfter: string, postedBefore: string): Promise<Parsed> {
  const all: Parsed = { fees: [], refunds: [] };
  const DAY = 86_400_000;
  for (let from = Date.parse(postedAfter); from < Date.parse(postedBefore); from += DAY) {
    const day = new Date(from).toISOString().slice(0, 10);
    const to = Math.min(from + DAY, Date.parse(postedBefore));
    let next: string | undefined;
    do {
      const q: Record<string, string> = next ? { NextToken: next } : { PostedAfter: new Date(from).toISOString(), PostedBefore: new Date(to).toISOString(), MaxResultsPerPage: "100" };
      const res = await amazon.sp("GET", "/finances/v0/financialEvents", q);
      const p = parseFinancialEvents(res.payload?.FinancialEvents ?? {}, day);
      all.fees.push(...p.fees);
      all.refunds.push(...p.refunds);
      next = res.payload?.NextToken;
      await amazon.pause(2100); // 0.5 requests per second
    } while (next);
  }
  return all;
}

/** Replace the real (not estimated) fee and refund rows posted on or after `fromDay`. */
export function saveFinances(db: Database, p: Parsed, fromDay: string, accountId = 1): void {
  const fee = db.query("INSERT INTO fee_events (account_id, order_id, sku, day, kind, amount_cents, estimated) VALUES (?,?,?,?,?,?,0)");
  const refund = db.query("INSERT INTO refunds (account_id, order_id, sku, day, refunded_cents, refunded_fees_cents) VALUES (?,?,?,?,?,?)");
  db.transaction(() => {
    db.query("DELETE FROM fee_events WHERE account_id=? AND day>=? AND estimated=0").run(accountId, fromDay);
    db.query("DELETE FROM refunds WHERE account_id=? AND day>=?").run(accountId, fromDay);
    for (const f of p.fees) fee.run(accountId, f.order_id, f.sku, f.day, f.kind, f.amount_cents);
    for (const r of p.refunds) refund.run(accountId, r.order_id, r.sku, r.day, r.refunded_cents, r.refunded_fees_cents);
  })();
}

/**
 * Shipped customer orders from `fromDay` that have no fee event yet get an estimated referral and FBA fee,
 * from the SKU's own past rate (referral share of sales, FBA fee per unit, last 90 days of confirmed fees).
 * A SKU with no history gets none. Old estimates are dropped first, so a confirmed fee replaces its estimate.
 * Returns the number of estimated rows written.
 */
export function estimateFees(db: Database, fromDay: string, accountId = 1): number {
  db.query("DELETE FROM fee_events WHERE account_id=? AND estimated=1").run(accountId);
  const rates = db.query(`
    SELECT o.sku,
           1.0 * SUM(f.referral) / NULLIF(SUM(o.item_sales_cents), 0) AS referral_share,
           1.0 * SUM(f.fba) / NULLIF(SUM(o.units), 0) AS fba_per_unit
    FROM orders o JOIN (
      SELECT order_id, sku, SUM(CASE WHEN kind='referral' THEN amount_cents ELSE 0 END) AS referral, SUM(CASE WHEN kind='fba' THEN amount_cents ELSE 0 END) AS fba
      FROM fee_events WHERE account_id=?1 AND estimated=0 AND order_id IS NOT NULL GROUP BY order_id, sku) f
      ON f.order_id=o.order_id AND f.sku=o.sku
    WHERE o.account_id=?1 AND o.status='shipped' AND o.channel='afn' AND o.day >= date('now','-90 day')
    GROUP BY o.sku`).all(accountId) as { sku: string; referral_share: number | null; fba_per_unit: number | null }[];
  const rate = new Map(rates.map((r) => [r.sku, r]));
  const pending = db.query(`
    SELECT order_id, sku, day, units, item_sales_cents FROM orders o
    WHERE account_id=?1 AND day>=?2 AND status='shipped' AND channel='afn' AND order_id NOT LIKE 'S01-%'
      AND NOT EXISTS (SELECT 1 FROM fee_events f WHERE f.account_id=o.account_id AND f.order_id=o.order_id AND f.sku=o.sku)`).all(accountId, fromDay) as any[];
  const insert = db.query("INSERT INTO fee_events (account_id, order_id, sku, day, kind, amount_cents, estimated) VALUES (?,?,?,?,?,?,1)");
  let n = 0;
  db.transaction(() => {
    for (const o of pending) {
      const r = rate.get(o.sku);
      if (!r) continue;
      if (r.referral_share) { insert.run(accountId, o.order_id, o.sku, o.day, "referral", Math.round(r.referral_share * o.item_sales_cents)); n++; }
      if (r.fba_per_unit) { insert.run(accountId, o.order_id, o.sku, o.day, "fba", Math.round(r.fba_per_unit * o.units)); n++; }
    }
  })();
  return n;
}

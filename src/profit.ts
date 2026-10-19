import type { Database } from "bun:sqlite";

// Profit definition: docs in design.md. All money in cents, days are Pacific dates.
// profit = item sales - fees - refunds (net of refunded fees) - ad spend - COGS, per SKU per day.
// Account-level rows (storage, subscription, reimbursement, SB / campaign-level ads) are one "Other" line (sku = null).
// Excluded: cancelled orders, MCF and Vine orders, `S01-` ids, and the fees/refunds that belong to them.

export type Range = { from: string; to: string; accountId?: number };

export type ProfitLine = {
  day: string;
  sku: string | null; // null = Other
  sales: number;
  fees: number;
  refunds: number;
  ads: number;
  cogs: number;
  profit: number;
  estimated: boolean; // some fee on this line is an estimate
  cogsMissing: boolean; // units sold with no unit cost on file
};

export type Total = Omit<ProfitLine, "day" | "sku">;

export type Summary = {
  skus: (Total & { sku: string })[];
  other: Total;
  account: Total;
};

const SKU_FEES = new Set(["referral", "fba", "other_order"]);

const empty = (): Total => ({ sales: 0, fees: 0, refunds: 0, ads: 0, cogs: 0, profit: 0, estimated: false, cogsMissing: false });

/** One line per (day, sku) plus one Other line per day, for orders/fees/refunds/ads inside the range. */
export function profitLines(db: Database, { from, to, accountId = 1 }: Range): ProfitLine[] {
  const args = [accountId, from, to];
  const all = (sql: string) => db.query(sql).all(...args) as Record<string, any>[];

  const orders = all("SELECT * FROM orders WHERE account_id=? AND day BETWEEN ? AND ?");
  const skipped = new Set<string>(); // orders that never count
  for (const o of orders) if (o.status === "cancelled" || o.channel !== "afn" || o.order_id.startsWith("S01-")) skipped.add(o.order_id);
  const counts = (o: { order_id: string | null }) => !o.order_id || !skipped.has(o.order_id);

  const lines = new Map<string, ProfitLine>();
  const line = (day: string, sku: string | null) => {
    const key = `${day}|${sku ?? ""}`;
    let l = lines.get(key);
    if (!l) lines.set(key, (l = { day, sku, sales: 0, fees: 0, refunds: 0, ads: 0, cogs: 0, profit: 0, estimated: false, cogsMissing: false }));
    return l;
  };

  const costs = new Map<string, { from_day: string; cents: number }[]>();
  for (const c of db.query("SELECT sku, from_day, unit_cost_cents FROM cogs WHERE account_id=? ORDER BY from_day").all(accountId) as any[]) {
    const list = costs.get(c.sku) ?? [];
    list.push({ from_day: c.from_day, cents: c.unit_cost_cents });
    costs.set(c.sku, list);
  }
  const unitCost = (sku: string, day: string) => costs.get(sku)?.filter((c) => c.from_day <= day).at(-1)?.cents;

  for (const o of orders) {
    if (skipped.has(o.order_id)) continue;
    const l = line(o.day, o.sku);
    l.sales += o.item_sales_cents;
    const cost = unitCost(o.sku, o.day);
    if (cost === undefined) l.cogsMissing = true;
    else l.cogs += cost * o.units;
  }

  for (const f of all("SELECT * FROM fee_events WHERE account_id=? AND day BETWEEN ? AND ?")) {
    if (!counts(f)) continue;
    const l = line(f.day, f.sku && SKU_FEES.has(f.kind) ? f.sku : null);
    l.fees += f.amount_cents;
    if (f.estimated) l.estimated = true;
  }

  for (const r of all("SELECT * FROM refunds WHERE account_id=? AND day BETWEEN ? AND ?")) {
    if (!counts(r)) continue;
    line(r.day, r.sku).refunds += r.refunded_cents - r.refunded_fees_cents;
  }

  for (const a of all("SELECT * FROM ad_spend WHERE account_id=? AND day BETWEEN ? AND ?")) {
    line(a.day, a.sku && a.campaign_type !== "SB" ? a.sku : null).ads += a.spend_cents;
  }

  const out = [...lines.values()];
  for (const l of out) l.profit = l.sales - l.fees - l.refunds - l.ads - l.cogs;
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.sku ?? "￿").localeCompare(b.sku ?? "￿"));
}

function add(t: Total, l: Total) {
  t.sales += l.sales; t.fees += l.fees; t.refunds += l.refunds; t.ads += l.ads; t.cogs += l.cogs; t.profit += l.profit;
  t.estimated ||= l.estimated; t.cogsMissing ||= l.cogsMissing;
}

/** Per-SKU totals, the Other line and the account total, which is always sum(SKU) + Other. */
export function summarize(lines: ProfitLine[]): Summary {
  const bySku = new Map<string, Total & { sku: string }>();
  const other = empty(), account = empty();
  for (const l of lines) {
    add(account, l);
    if (l.sku === null) { add(other, l); continue; }
    let t = bySku.get(l.sku);
    if (!t) bySku.set(l.sku, (t = { sku: l.sku, ...empty() }));
    add(t, l);
  }
  return { skus: [...bySku.values()].sort((a, b) => b.profit - a.profit), other, account };
}

export const profit = (db: Database, range: Range): Summary => summarize(profitLines(db, range));

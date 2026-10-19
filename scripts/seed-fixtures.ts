// Deterministic synthetic data for a fictional seller. Never captured from a real account.
// `bun scripts/seed-fixtures.ts` writes test/fixtures/*.json; `--check` fails if they differ from a fresh run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dir, "..", "test", "fixtures");
const SEED = 20260101;
const DAYS = 90;
const START = Date.UTC(2026, 0, 1);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CATALOGUE = [
  { sku: "DEMO-MUG-01", asin: "B0SF000001", title: "Demo Ceramic Mug", price: 1899, cost: 520, fba: 410, perDay: 6 },
  { sku: "DEMO-LAMP-02", asin: "B0SF000002", title: "Demo Desk Lamp", price: 3499, cost: 1250, fba: 560, perDay: 4 },
  { sku: "DEMO-BAG-03", asin: "B0SF000003", title: "Demo Canvas Tote", price: 2299, cost: 640, fba: 450, perDay: 5 },
  { sku: "DEMO-MAT-04", asin: "B0SF000004", title: "Demo Yoga Mat", price: 2999, cost: 980, fba: 620, perDay: 3 },
  { sku: "DEMO-CUP-05", asin: "B0SF000005", title: "Demo Travel Cup", price: 1599, cost: 430, fba: 380, perDay: 2 },
];

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const dayOf = (i: number) => new Date(START + i * 86400000).toISOString().slice(0, 10);

export function build() {
  const r = rng(SEED);
  const orders: object[] = [], fees: object[] = [], refunds: object[] = [], ads: object[] = [];
  let seq = 0;
  for (let d = 0; d < DAYS; d++) {
    const day = dayOf(d);
    for (const p of CATALOGUE) {
      const n = Math.max(0, Math.round(p.perDay * (0.6 + r() * 0.8)));
      for (let k = 0; k < n; k++) {
        seq++;
        const orderId = `000-${pad(seq, 7)}-${pad(seq, 7)}`; // 000- prefix: never a real Amazon id
        const units = 1 + (r() < 0.12 ? 1 : 0);
        const cancelled = r() < 0.03;
        orders.push({ order_id: orderId, sku: p.sku, day, units, item_sales_cents: p.price * units, status: cancelled ? "cancelled" : "shipped", channel: "afn" });
        if (cancelled) continue;
        const estimated = d >= DAYS - 3 ? 1 : 0; // newest days have no fee events yet
        fees.push({ order_id: orderId, sku: p.sku, day, kind: "referral", amount_cents: Math.round(p.price * units * 0.15), estimated });
        fees.push({ order_id: orderId, sku: p.sku, day, kind: "fba", amount_cents: p.fba * units, estimated });
        if (r() < 0.05) refunds.push({ order_id: orderId, sku: p.sku, day: dayOf(Math.min(DAYS - 1, d + 3)), refunded_cents: p.price * units, refunded_fees_cents: Math.round(p.price * units * 0.15 * 0.8) });
      }
      ads.push({ day, sku: p.sku, campaign_type: "SP", spend_cents: Math.round(p.perDay * 40 * (0.5 + r())) });
    }
    ads.push({ day, sku: null, campaign_type: "SB", spend_cents: Math.round(300 * (0.5 + r())) });
    if (d % 30 === 0) fees.push({ order_id: null, sku: null, day, kind: "storage", amount_cents: 4200 + Math.round(r() * 800), estimated: 0 });
    if (d % 30 === 0) fees.push({ order_id: null, sku: null, day, kind: "subscription", amount_cents: 3999, estimated: 0 });
  }
  return {
    "products.json": CATALOGUE.map(({ sku, asin, title }) => ({ sku, asin, title })),
    "orders.json": orders,
    "fee_events.json": fees,
    "refunds.json": refunds,
    "ad_spend.json": ads,
    "cogs.json": CATALOGUE.map((p) => ({ sku: p.sku, unit_cost_cents: p.cost, from_day: dayOf(0) })),
  } as Record<string, object[]>;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const [name, rows] of Object.entries(build())) {
    const text = "[\n" + rows.map((x) => JSON.stringify(x)).join(",\n") + "\n]\n";
    const path = join(OUT, name);
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) { console.error(`fixture differs from seed: ${name}`); bad++; }
    } else writeFileSync(path, text);
  }
  if (check) { if (bad) process.exit(1); console.log("fixtures match the seed"); }
}

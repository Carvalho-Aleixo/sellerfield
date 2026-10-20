import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { openDb } from "../src/db";
import { profit } from "../src/profit";
import { Amazon } from "../src/amazon/client";
import { parseOrdersReport, saveOrders } from "../src/amazon/orders";
import { estimateFees, parseFinancialEvents, saveFinances } from "../src/amazon/finances";
import { parseAdsReport } from "../src/amazon/ads";
import { sync } from "../src/sync";
import { chunks, pacificDay } from "../src/amazon/time";

const HEAD = ["amazon-order-id", "purchase-date", "order-status", "sales-channel", "product-name", "sku", "asin", "item-status", "quantity", "item-price", "item-promotion-discount"];
const tsv = (...rows: string[][]) => [HEAD, ...rows].map((r) => r.join("\t")).join("\n");
const row = (id: string, o: Partial<Record<(typeof HEAD)[number], string>> = {}) =>
  HEAD.map((h) => ({ "amazon-order-id": id, "purchase-date": "2026-01-02T12:00:00+00:00", "order-status": "Shipped", "sales-channel": "Amazon.com", "product-name": "Mug", sku: "DEMO-MUG-01", asin: "B0SF000001", "item-status": "Shipped", quantity: "1", "item-price": "18.99", "item-promotion-discount": "", ...o })[h] ?? "");

test("orders report: sales net of promotion, status and channel rules, one row per order and SKU", () => {
  const rows = parseOrdersReport(tsv(
    row("000-0000001-0000001", { quantity: "2", "item-price": "37.98", "item-promotion-discount": "3.00" }),
    row("000-0000002-0000002", { "order-status": "Pending", "item-price": "" }),
    row("000-0000003-0000003", { "order-status": "Cancelled", "item-status": "Cancelled", "item-price": "" }),
    row("000-0000004-0000004", { "sales-channel": "Non-Amazon US" }),
    row("S01-0000005-0000005"),
    row("000-0000006-0000006", { "item-price": "0.00" }),
    row("000-0000007-0000007"),
    row("000-0000007-0000007"),
    row("000-0000008-0000008", { "purchase-date": "2026-01-03T05:30:00+00:00" }),
  ));
  const by = Object.fromEntries(rows.map((r) => [r.order_id, r]));
  expect(by["000-0000001-0000001"]).toMatchObject({ units: 2, item_sales_cents: 3498, status: "shipped", channel: "afn", day: "2026-01-02" });
  expect(by["000-0000002-0000002"]).toBeUndefined();
  expect(by["000-0000003-0000003"]).toMatchObject({ status: "cancelled", channel: "afn" });
  expect(by["000-0000004-0000004"].channel).toBe("mcf");
  expect(by["S01-0000005-0000005"].channel).toBe("mcf");
  expect(by["000-0000006-0000006"].channel).toBe("vine");
  expect(by["000-0000007-0000007"]).toMatchObject({ units: 2, item_sales_cents: 3798 });
  expect(by["000-0000008-0000008"].day).toBe("2026-01-02"); // 05:30 UTC is still the evening before in Pacific time
});

const money = (v: number) => ({ CurrencyAmount: v });
const events = {
  ShipmentEventList: [
    { AmazonOrderId: "000-0000001-0000001", PostedDate: "2026-01-03T10:00:00Z", ShipmentItemList: [{ SellerSKU: "DEMO-MUG-01", ItemFeeList: [{ FeeType: "Commission", FeeAmount: money(-2.85) }, { FeeType: "FBAPerUnitFulfillmentFee", FeeAmount: money(-4.1) }, { FeeType: "DigitalServicesFee", FeeAmount: money(-0.06) }] }] },
    { AmazonOrderId: "S01-0000009-0000009", PostedDate: "2026-01-03T10:00:00Z", ShipmentItemList: [{ SellerSKU: "DEMO-MUG-01", ItemFeeList: [{ FeeType: "Commission", FeeAmount: money(-1) }] }] },
  ],
  RefundEventList: [
    { AmazonOrderId: "000-0000001-0000001", PostedDate: "2026-01-05T10:00:00Z", ShipmentItemAdjustmentList: [{ SellerSKU: "DEMO-MUG-01", ItemChargeAdjustmentList: [{ ChargeType: "Principal", ChargeAmount: money(-18.99) }, { ChargeType: "Tax", ChargeAmount: money(-1) }], ItemFeeAdjustmentList: [{ FeeType: "Commission", FeeAmount: money(2.85) }, { FeeType: "RefundCommission", FeeAmount: money(-0.57) }] }] },
  ],
  ServiceFeeEventList: [{ FeeList: [{ FeeType: "FBAStorageFee", FeeAmount: money(-1.2) }] }],
  AdjustmentEventList: [{ AdjustmentType: "REVERSAL_REIMBURSEMENT", PostedDate: "2026-01-07T10:00:00Z", AdjustmentAmount: money(5) }],
};

test("finance events: fees positive, refund net of refunded fees, account-level rows, multi-channel dropped", () => {
  const { fees, refunds } = parseFinancialEvents(events, "2026-01-06");
  expect(fees.filter((f) => f.order_id).map((f) => [f.kind, f.amount_cents])).toEqual([["referral", 285], ["fba", 410], ["other_order", 6]]);
  expect(fees.filter((f) => !f.order_id).map((f) => [f.kind, f.amount_cents])).toEqual([["storage", 120], ["reimbursement", -500]]);
  expect(refunds).toEqual([{ order_id: "000-0000001-0000001", sku: "DEMO-MUG-01", day: "2026-01-05", refunded_cents: 1899, refunded_fees_cents: 228 }]);
});

test("estimated fees: unfunded orders use the SKU's own rate, and a confirmed fee replaces the estimate", () => {
  const db = openDb(":memory:");
  const day = new Date().toISOString().slice(0, 10);
  saveOrders(db, [
    { order_id: "000-0000001-0000001", sku: "S1", asin: "B0SF000001", title: "Mug", day, units: 1, item_sales_cents: 2000, status: "shipped", channel: "afn" },
    { order_id: "000-0000002-0000002", sku: "S1", asin: "B0SF000001", title: "Mug", day, units: 2, item_sales_cents: 4000, status: "shipped", channel: "afn" },
    { order_id: "000-0000003-0000003", sku: "S2", asin: "B0SF000002", title: "Lamp", day, units: 1, item_sales_cents: 3000, status: "shipped", channel: "afn" },
  ]);
  saveFinances(db, { fees: [{ order_id: "000-0000001-0000001", sku: "S1", day, kind: "referral", amount_cents: 300 }, { order_id: "000-0000001-0000001", sku: "S1", day, kind: "fba", amount_cents: 400 }], refunds: [] }, day);
  expect(estimateFees(db, day)).toBe(2); // order 2 only: S2 has no history
  const est = db.query("SELECT order_id, kind, amount_cents FROM fee_events WHERE estimated=1 ORDER BY kind").all();
  expect(est).toEqual([{ order_id: "000-0000002-0000002", kind: "fba", amount_cents: 800 }, { order_id: "000-0000002-0000002", kind: "referral", amount_cents: 600 }]);
  expect(profit(db, { from: day, to: day }).account.estimated).toBe(true);
  const confirmed = db.query("SELECT order_id, sku, day, kind, amount_cents FROM fee_events WHERE estimated=0").all() as any[];
  saveFinances(db, { fees: [...confirmed, { order_id: "000-0000002-0000002", sku: "S1", day, kind: "referral", amount_cents: 590 }], refunds: [] }, day);
  expect(estimateFees(db, day)).toBe(0);
  expect(db.query("SELECT COUNT(*) AS n FROM fee_events WHERE estimated=1").get()).toEqual({ n: 0 });
});

test("ads report: spend per day and SKU in cents; Brands rows have no SKU", () => {
  const sp = JSON.stringify([{ date: "2026-01-02", advertisedSku: "A", cost: 1.5 }, { date: "2026-01-02", advertisedSku: "A", cost: 0.25 }, { date: "2026-01-02", advertisedSku: "B", cost: 0 }]);
  expect(parseAdsReport(sp, "SP")).toEqual([{ day: "2026-01-02", sku: "A", campaign_type: "SP", spend_cents: 175 }]);
  expect(parseAdsReport(JSON.stringify([{ date: "2026-01-02", campaignId: "1", cost: 2 }]), "SB")).toEqual([{ day: "2026-01-02", sku: null, campaign_type: "SB", spend_cents: 200 }]);
});

test("date helpers", () => {
  expect(pacificDay("2026-07-01T06:59:00Z")).toBe("2026-06-30");
  expect(chunks("2026-01-01", "2026-03-05", 31)).toEqual([{ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-02-01", to: "2026-03-03" }, { from: "2026-03-04", to: "2026-03-05" }]);
});

test("sync end to end against a fake Amazon: rows land, a failing source is recorded, a throttled call is retried", async () => {
  const now = new Date("2026-01-10T18:00:00Z");
  let throttled = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fake = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    if (u.host === "api.amazon.com") return json({ access_token: "tok", expires_in: 3600 });
    if (u.host === "files.example.com") {
      if (u.pathname === "/orders") return new Response(tsv(row("000-0000001-0000001", { "purchase-date": "2026-01-08T18:00:00+00:00" })));
      if (u.pathname === "/ads-sp") return new Response(gzipSync(JSON.stringify([{ date: "2026-01-08", advertisedSku: "DEMO-MUG-01", cost: 2.02 }])));
      return new Response("[]");
    }
    if (u.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") return json({ reportId: "r1" });
    if (u.pathname === "/reports/2021-06-30/reports/r1") {
      if (!throttled) { throttled = true; return new Response("slow down", { status: 429 }); }
      return json({ processingStatus: "DONE", reportDocumentId: "d1" });
    }
    if (u.pathname === "/reports/2021-06-30/documents/d1") return json({ url: "https://files.example.com/orders" });
    if (u.pathname === "/finances/v0/financialEvents") {
      const posted = "2026-01-09T10:00:00Z", inWindow = u.searchParams.get("PostedAfter")! <= posted && posted < u.searchParams.get("PostedBefore")!;
      return json({ payload: { FinancialEvents: { ShipmentEventList: inWindow ? [{ ...events.ShipmentEventList[0], PostedDate: posted }] : [] } } });
    }
    if (u.pathname === "/reporting/reports" && init?.method === "POST") return json({ reportId: `ad-${JSON.parse(String(init.body)).configuration.reportTypeId}` });
    if (u.pathname === "/reporting/reports/ad-spAdvertisedProduct") return json({ status: "COMPLETED", url: "https://files.example.com/ads-sp" });
    if (u.pathname === "/reporting/reports/ad-sdAdvertisedProduct") return json({ status: "FAILURE", failureReason: "no access" });
    if (u.pathname.startsWith("/reporting/reports/")) return json({ status: "COMPLETED", url: "https://files.example.com/empty" });
    return new Response("unexpected " + u.pathname, { status: 404 });
  };
  const creds = { spClientId: "c", spClientSecret: "s", spRefreshToken: "r", adsClientId: "c", adsClientSecret: "s", adsRefreshToken: "r", adsProfileId: "1" };
  const db = openDb(":memory:");
  const results = await sync(db, new Amazon(creds, fake, async () => {}), 7, now);
  expect(results.map((r) => [r.source, r.status])).toEqual([["orders", "ok"], ["finances", "ok"], ["ads", "error"]]);
  expect(results[2].detail).toContain("no access");
  expect(throttled).toBe(true);
  expect(db.query("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 1 });
  expect(db.query("SELECT COUNT(*) AS n FROM fee_events WHERE estimated=0").get()).toEqual({ n: 3 });
  expect(db.query("SELECT spend_cents FROM ad_spend WHERE campaign_type='SP'").all()).toEqual([{ spend_cents: 202 }]);
  expect(db.query("SELECT source, status FROM sync_runs ORDER BY id").all()).toEqual([{ source: "orders", status: "ok" }, { source: "finances", status: "ok" }, { source: "ads", status: "error" }]);
  const p = profit(db, { from: "2026-01-01", to: "2026-01-10" });
  expect(p.account.sales).toBe(1899);
  expect(p.account.fees).toBe(285 + 410 + 6);
  expect(p.account.estimated).toBe(false);
  expect(p.account.ads).toBe(202);
});

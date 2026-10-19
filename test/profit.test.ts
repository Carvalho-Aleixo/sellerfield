import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openDb } from "../src/db";
import { loadFixtures } from "../src/fixtures";
import { profit } from "../src/profit";

const fx = (n: string): any[] => JSON.parse(readFileSync(`${__dirname}/fixtures/${n}.json`, "utf8"));
const R = { from: "2026-01-01", to: "2026-12-31" };

test("sum of SKU profit + Other = account profit, computed independently from the raw fixtures", () => {
  const db = openDb(":memory:");
  loadFixtures(db);
  const s = profit(db, R);

  const orders = fx("orders"), cogs = fx("cogs");
  const good = new Set(orders.filter((o) => o.status === "shipped" && o.channel === "afn").map((o) => o.order_id));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const expected =
    sum(orders.filter((o) => good.has(o.order_id)).map((o) => o.item_sales_cents - o.units * cogs.find((c) => c.sku === o.sku).unit_cost_cents)) -
    sum(fx("fee_events").filter((f) => !f.order_id || good.has(f.order_id)).map((f) => f.amount_cents)) -
    sum(fx("refunds").filter((r) => good.has(r.order_id)).map((r) => r.refunded_cents - r.refunded_fees_cents)) -
    sum(fx("ad_spend").map((a) => a.spend_cents));

  expect(s.account.profit).toBe(expected);
  expect(sum(s.skus.map((k) => k.profit)) + s.other.profit).toBe(s.account.profit);
  expect(s.skus.length).toBe(5);
  expect(s.account.estimated).toBe(true); // newest days carry estimated fees
});

test("Other holds account-level rows; excluded orders and their fees never count", () => {
  const db = openDb(":memory:");
  const d = "2026-03-01";
  db.exec(`
    INSERT INTO orders (order_id,sku,day,units,item_sales_cents,status,channel) VALUES
      ('000-1','A','${d}',2,2000,'shipped','afn'),
      ('000-2','A','${d}',1,1000,'cancelled','afn'),
      ('000-3','A','${d}',1,1000,'shipped','mcf'),
      ('S01-4','A','${d}',1,1000,'shipped','afn');
    INSERT INTO cogs (sku,unit_cost_cents,from_day) VALUES ('A',100,'2026-01-01'),('A',300,'2026-03-02');
    INSERT INTO fee_events (order_id,sku,day,kind,amount_cents,estimated) VALUES
      ('000-1','A','${d}','referral',300,0),('000-1','A','${d}','fba',200,1),
      ('000-2','A','${d}','referral',150,0),
      (NULL,NULL,'${d}','storage',50,0),('000-1','A','${d}','reimbursement',-40,0);
    INSERT INTO refunds (order_id,sku,day,refunded_cents,refunded_fees_cents) VALUES ('000-1','A','${d}',1000,150),('000-2','A','${d}',1000,0);
    INSERT INTO ad_spend (day,sku,campaign_type,spend_cents) VALUES ('${d}','A','SP',70),('${d}',NULL,'SB',30),('${d}','A','SB',10);
  `);
  const s = profit(db, { from: d, to: d });
  // A: sales 2000 - fees 500 - refund 850 - ads 70 - cogs 2*100
  expect(s.skus).toHaveLength(1);
  expect(s.skus[0]).toMatchObject({ sku: "A", sales: 2000, fees: 500, refunds: 850, ads: 70, cogs: 200, profit: 380, estimated: true });
  // Other: storage 50 + reimbursement -40 + SB ads 30 + 10
  expect(s.other).toMatchObject({ fees: 10, ads: 40, profit: -50 });
  expect(s.account.profit).toBe(330);
});

test("a SKU with no unit cost is flagged, not silently free", () => {
  const db = openDb(":memory:");
  db.exec(`INSERT INTO orders (order_id,sku,day,units,item_sales_cents) VALUES ('000-1','B','2026-03-01',1,500)`);
  expect(profit(db, R).skus[0]).toMatchObject({ sku: "B", profit: 500, cogsMissing: true });
});

// Hand-made fixtures for the mocked specs. Fictional products, internally consistent (profit = sales - fees - refunds - ads - cogs,
// account = SKUs + Other), so the page never shows an impossible reconciliation.
type Total = { sales: number; fees: number; refunds: number; ads: number; cogs: number; profit: number; estimated: boolean; cogsMissing: boolean };
const total = (t: Partial<Total>): Total => {
  const x = { sales: 0, fees: 0, refunds: 0, ads: 0, cogs: 0, estimated: false, cogsMissing: false, ...t };
  return { ...x, profit: x.sales - x.fees - x.refunds - x.ads - x.cogs };
};
const sum = (ts: Total[]): Total => {
  const s = total({});
  for (const t of ts) {
    s.sales += t.sales; s.fees += t.fees; s.refunds += t.refunds; s.ads += t.ads; s.cogs += t.cogs; s.profit += t.profit;
    s.estimated ||= t.estimated; s.cogsMissing ||= t.cogsMissing;
  }
  return s;
};

const DAYS = 14;
const dayAt = (i: number) => new Date(Date.UTC(2026, 2, 18 + i)).toISOString().slice(0, 10);
const profits = [5200, 6100, 4800, 7300, 6900, 2100, 1500, 6600, 7100, 5900, 6400, 7800, 7200, 6800];
const dailyOf = (profit: number[], lossAt = -1) =>
  profit.map((p, i) => ({ day: dayAt(i), sales: Math.round(Math.abs(p) * 3.1), profit: i === lossAt ? -900 : p, estimated: i >= profit.length - 3 }));

const products = { "DEMO-MUG-01": "Demo Ceramic Mug", "DEMO-LAMP-02": "Demo Desk Lamp", "DEMO-BAG-03": "Demo Canvas Tote" };
const cogs = {
  "DEMO-MUG-01": { unit_cost_cents: 520, from_day: "2026-01-01" },
  "DEMO-LAMP-02": { unit_cost_cents: 1250, from_day: "2026-01-01" },
  "DEMO-BAG-03": { unit_cost_cents: 640, from_day: "2026-01-01" },
};

const skus = [
  { sku: "DEMO-LAMP-02", ...total({ sales: 183400, fees: 62100, refunds: 4200, ads: 9100, cogs: 65000, estimated: true }) },
  { sku: "DEMO-MUG-01", ...total({ sales: 127900, fees: 47300, refunds: 3800, ads: 12400, cogs: 35100 }) },
  { sku: "DEMO-BAG-03", ...total({ sales: 91600, fees: 34000, refunds: 9100, ads: 15800, cogs: 25600, estimated: true }) },
];
const other = total({ fees: 6200, ads: 4100 });
const summary = { skus, other, account: sum([...skus, other]) };

export const report = { demo: true, from: dayAt(0), to: dayAt(DAYS - 1), summary, daily: dailyOf(profits, 6), products, cogs };

/** Not demo, one product has no unit cost, one loses money. */
const lossy = { sku: "DEMO-BAG-03", ...total({ sales: 91600, fees: 34000, refunds: 9100, ads: 41800, cogs: 25600, cogsMissing: true }) };
const skus2 = [skus[0], skus[1], lossy];
export const reportMissingCost = {
  ...report,
  demo: false,
  summary: { skus: skus2, other, account: sum([...skus2, other]) },
  cogs: { "DEMO-MUG-01": cogs["DEMO-MUG-01"], "DEMO-LAMP-02": cogs["DEMO-LAMP-02"] },
};

export const reportEmpty = { demo: false, from: null, to: null, summary: { skus: [], other: total({}), account: total({}) }, daily: [], products: {}, cogs: {} };

/** Product titles come from Amazon, so they are untrusted text: markup and a URL must stay text. */
export const reportHostile = {
  ...report,
  products: { ...products, "DEMO-MUG-01": `<b>Bold</b> <img src=x onerror=alert(1)> https://example.com/mug` },
};

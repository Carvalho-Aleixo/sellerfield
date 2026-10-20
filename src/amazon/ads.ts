import type { Database } from "bun:sqlite";
import { Amazon } from "./client";
import { cents, chunks } from "./time";

export type AdRow = { day: string; sku: string | null; campaign_type: "SP" | "SD" | "SB"; spend_cents: number };

// Ads API v3 report types. SP and SD list the advertised product (so spend has a SKU); SB reports campaigns only (spend goes to Other).
const REPORTS = {
  SP: { adProduct: "SPONSORED_PRODUCTS", reportTypeId: "spAdvertisedProduct", groupBy: ["advertiser"], columns: ["date", "advertisedSku", "cost"], sku: "advertisedSku" },
  SD: { adProduct: "SPONSORED_DISPLAY", reportTypeId: "sdAdvertisedProduct", groupBy: ["advertiser"], columns: ["date", "promotedSku", "cost"], sku: "promotedSku" },
  SB: { adProduct: "SPONSORED_BRANDS", reportTypeId: "sbCampaigns", groupBy: ["campaign"], columns: ["date", "campaignId", "cost"], sku: null },
} as const;

/** Rows of one downloaded report (a JSON array) summed per day and SKU. */
export function parseAdsReport(json: string, type: keyof typeof REPORTS): AdRow[] {
  const sku = REPORTS[type].sku;
  const sums = new Map<string, AdRow>();
  for (const r of JSON.parse(json || "[]")) {
    const row = { day: r.date as string, sku: sku ? (r[sku] as string) : null, campaign_type: type };
    const key = `${row.day}|${row.sku ?? ""}`;
    const hit = sums.get(key);
    if (hit) hit.spend_cents += cents(r.cost);
    else sums.set(key, { ...row, spend_cents: cents(r.cost) });
  }
  return [...sums.values()].filter((r) => r.spend_cents !== 0);
}

/** Daily spend for [from, to] (inclusive ISO dates) of one campaign type; the API takes at most 31 days per report. */
export async function fetchAdSpend(amazon: Amazon, type: keyof typeof REPORTS, from: string, to: string): Promise<AdRow[]> {
  const spec = REPORTS[type];
  const out: AdRow[] = [];
  for (const c of chunks(from, to, 31)) {
    const { reportId } = await amazon.ads("POST", "/reporting/reports", {
      name: `sellerfield ${type} ${c.from}`, startDate: c.from, endDate: c.to,
      configuration: { adProduct: spec.adProduct, groupBy: spec.groupBy, columns: spec.columns, reportTypeId: spec.reportTypeId, timeUnit: "DAILY", format: "GZIP_JSON" },
    });
    let url: string | undefined;
    for (let i = 0; i < 120 && !url; i++) {
      const r = await amazon.ads("GET", `/reporting/reports/${reportId}`);
      if (r.status === "COMPLETED") url = r.url;
      else if (r.status === "FAILURE") throw new Error(`${type} ads report failed: ${r.failureReason ?? ""}`);
      else await amazon.pause(15_000);
    }
    if (!url) throw new Error(`${type} ads report not ready after 30 minutes`);
    out.push(...parseAdsReport(await amazon.download(url), type));
  }
  return out;
}

/** Replace the ad spend rows of the given types on or after `fromDay`. */
export function saveAdSpend(db: Database, rows: AdRow[], types: string[], fromDay: string, accountId = 1): void {
  const insert = db.query("INSERT INTO ad_spend (account_id, day, sku, campaign_type, spend_cents) VALUES (?,?,?,?,?)");
  db.transaction(() => {
    for (const t of types) db.query("DELETE FROM ad_spend WHERE account_id=? AND campaign_type=? AND day>=?").run(accountId, t, fromDay);
    for (const r of rows) insert.run(accountId, r.day, r.sku, r.campaign_type, r.spend_cents);
  })();
}

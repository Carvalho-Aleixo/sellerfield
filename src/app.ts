import type { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { join, normalize } from "node:path";
import { profitLines, summarize } from "./profit";

const WEB = join(import.meta.dir, "..", "web");
const ACCOUNT = 1;
const HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-cache",
};

export type AppOptions = { demo: boolean; password?: string };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const validDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && day(Date.parse(s)) === s;

/** Every day from..to, so the chart shows quiet days as zero. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) out.push(day(t));
  return out;
}

function report(db: Database, days: number, demo: boolean) {
  const span = db.query("SELECT MIN(day) AS first, MAX(day) AS last FROM orders WHERE account_id=?").get(ACCOUNT) as { first: string | null; last: string | null };
  const products = Object.fromEntries((db.query("SELECT sku, title FROM products WHERE account_id=?").all(ACCOUNT) as any[]).map((p) => [p.sku, p.title]));
  const cogs: Record<string, { unit_cost_cents: number; from_day: string }> = {};
  for (const c of db.query("SELECT sku, unit_cost_cents, from_day FROM cogs WHERE account_id=? ORDER BY from_day").all(ACCOUNT) as any[])
    cogs[c.sku] = { unit_cost_cents: c.unit_cost_cents, from_day: c.from_day };
  if (!span.last || !span.first) {
    const none = summarize([]);
    return { demo, from: null, to: null, summary: none, daily: [], products, cogs };
  }
  const to = span.last;
  const from = days > 0 ? day(Math.max(Date.parse(span.first), Date.parse(to) - (days - 1) * 86400000)) : span.first;
  const lines = profitLines(db, { from, to, accountId: ACCOUNT });
  const byDay = new Map<string, { sales: number; profit: number; estimated: boolean }>();
  for (const l of lines) {
    const d = byDay.get(l.day) ?? { sales: 0, profit: 0, estimated: false };
    d.sales += l.sales; d.profit += l.profit; d.estimated ||= l.estimated;
    byDay.set(l.day, d);
  }
  const daily = eachDay(from, to).map((d) => ({ day: d, ...(byDay.get(d) ?? { sales: 0, profit: 0, estimated: false }) }));
  return { demo, from, to, summary: summarize(lines), daily, products, cogs };
}

function saveCost(db: Database, body: any) {
  const known = db.query("SELECT 1 FROM products WHERE account_id=? AND sku=?").get(ACCOUNT, body?.sku);
  if (!known) return "That product is not in your catalogue.";
  if (!Number.isInteger(body.unit_cost_cents) || body.unit_cost_cents < 0 || body.unit_cost_cents > 100_000_000) return "Enter a unit cost of $0.00 or more.";
  if (!validDay(body.from_day)) return "Enter the date this cost starts, for example 2026-01-31.";
  db.query("INSERT INTO cogs (account_id, sku, unit_cost_cents, from_day) VALUES (?,?,?,?) ON CONFLICT(account_id, sku, from_day) DO UPDATE SET unit_cost_cents=excluded.unit_cost_cents")
    .run(ACCOUNT, body.sku, body.unit_cost_cents, body.from_day);
  return null;
}

async function serveStatic(pathname: string) {
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  const rel = normalize(path === "/" ? "/index.html" : path);
  if (rel.includes("..")) return null;
  const file = Bun.file(join(WEB, rel));
  if (!(await file.exists())) return null;
  return new Response(file, { headers: HEADERS });
}

/** The whole app as one fetch handler: tests call it directly, server.ts puts it on a port. */
export function createApp(db: Database, { demo, password }: AppOptions) {
  return async (req: Request): Promise<Response> => {
    if (password) {
      const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Basic /i, ""), "base64").toString().split(":").slice(1).join(":");
      if (!sameSecret(given, password))
        return new Response("Password required", { status: 401, headers: { ...HEADERS, "www-authenticate": 'Basic realm="SellerField"' } });
    }
    const url = new URL(req.url);
    if (url.pathname === "/api/report" && req.method === "GET") {
      const days = Number(url.searchParams.get("days") ?? 30);
      return json(report(db, Number.isInteger(days) && days >= 0 ? days : 30, demo));
    }
    if (url.pathname === "/api/cogs" && req.method === "PUT") {
      const body = await req.json().catch(() => null);
      const error = saveCost(db, body);
      return error ? json({ error }, 400) : json({ ok: true });
    }
    if (req.method === "GET") {
      const res = await serveStatic(url.pathname);
      if (res) return res;
    }
    return json({ error: "not found" }, 404);
  };
}

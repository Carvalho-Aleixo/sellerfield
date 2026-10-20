// Adapted from ~/skills/web-testing/templates/test.ts. The layout and a11y checks are the template's, unchanged.
import { test as base, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as data from "./data";

export type Mocks = {
  /** Body of GET /api/report (default: the full demo-like report). */
  report?: unknown | { status: number; body: unknown };
  /** Answer for PUT /api/cogs. */
  cogs?: { status: number; body: unknown };
};

/** Paths the API owns. Anything under them that is not mocked fails the test. */
const API_PATH = /^\/api(\/|$)/;

type Fx = {
  problems: string[];
  allowed: RegExp[];
  guard: void;
  /** Install the API mocks. Call before page.goto. */
  mock: (m?: Mocks) => Promise<void>;
  /** Full-page screenshot into test-results/screens/, named per project, with the layout, a11y and baseline checks. */
  shot: (name: string, opts?: { overlay?: boolean }) => Promise<void>;
  /** Requests the page sent to the mocked API, "METHOD path" (PUT bodies in `bodies`). */
  calls: string[];
  bodies: unknown[];
};

const AXE_EXCLUDE: string[] = [];
const AXE_DISABLED_RULES: string[] = [];

async function layoutChecks(page: Page, project: string, name: string) {
  const problems = await page.evaluate((mobile) => {
    const out: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth) out.push(`[overflow] scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}`);
    // A reserved scrollbar gutter (or html without the page background) shows a blank strip at the right
    // edge on Windows/Linux and outside dialog backdrops (the maintainer, 2026-10-07).
    const hs = getComputedStyle(de);
    if ((hs as any).scrollbarGutter?.includes("stable")) out.push(`[edge] html has scrollbar-gutter: stable`);
    if (hs.backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)")
      out.push(`[edge] html has no background while body has one (blank strip beside the scrollbar)`);

    const modal = document.querySelector("dialog[open]");
    const inScope = (el: Element) => !modal || modal.contains(el);
    const desc = (el: Element) => {
      const t = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `<${el.tagName.toLowerCase()}${t ? ` "${t}"` : ""}>`;
    };
    const visible = (el: Element) => {
      if (inClosedDetails(el)) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return !(cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0" || r.width <= 1 || r.height <= 1);
    };
    const ignored = (el: Element) => !!el.closest("[data-layout-ignore]");
    // Content of a closed <details> (the mobile menu) is not rendered, but reports client rects.
    const inClosedDetails = (el: Element) => {
      const d = el.closest("details");
      return !!d && !d.open && !el.closest("summary");
    };

    // 2. tap targets (mobile)
    if (mobile) {
      const sel = "button, a[href], input:not([type=hidden]), select, textarea, [role=button]";
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!inScope(el) || !visible(el) || ignored(el)) continue;
        const cs = getComputedStyle(el);
        if (el.tagName === "A" && el.closest("p, li, label") && cs.display === "inline") continue;
        const h = el.getBoundingClientRect().height;
        if (h < 43.5) out.push(`[tap] ${desc(el)} is ${Math.round(h)}px tall (< 44)`);
      }
    }

    // 3. overlap
    type Box = { el: Element; l: number; t: number; r: number; b: number };
    const boxes: Box[] = [];
    const boxSel = "button, a[href], input:not([type=hidden]), select, textarea, img, [role=button]";
    for (const el of document.querySelectorAll(boxSel)) {
      if (!inScope(el) || !visible(el) || ignored(el)) continue;
      const r = el.getBoundingClientRect();
      boxes.push({ el, l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    for (const el of document.querySelectorAll("body *")) {
      if (!inScope(el) || ignored(el) || el.closest("svg, script, style")) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim());
      if (!own.length || !visible(el)) continue;
      // The text's own rect (not the element's box, which may be a full-width block).
      const range = document.createRange();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const n of own) {
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) {
          if (q.width <= 1 || q.height <= 1) continue;
          l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
        }
      }
      if (l === Infinity) continue;
      boxes.push({ el, l, t, r, b });
    }
    const T = 1;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
        const w = Math.min(a.r, c.r) - Math.max(a.l, c.l);
        const h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (w > T && h > T) out.push(`[overlap] ${desc(a.el)} and ${desc(c.el)} overlap by ${Math.round(w)}x${Math.round(h)}px`);
      }
    }

    // 4. squeezed text
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!inScope(el) || ignored(el) || el.closest("svg, script, style, textarea, select")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "inline" || cs.display === "none" || !visible(el)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      if (cs.whiteSpace === "nowrap" || cs.textOverflow === "ellipsis") continue;
      const words = (el.innerText || "").trim().split(/\s+/).filter(Boolean).length;
      if (words < 3) continue;
      // Large display headings (>= 28px) wrap by design on small screens.
      if (/^H[1-3]$/.test(el.tagName) && parseFloat(cs.fontSize) >= 28) continue;
      // Real line count: distinct line tops of the element's own text.
      const range = document.createRange();
      const tops = new Set<number>();
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent!.trim()) continue;
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4));
      }
      const lines = tops.size;
      if (lines >= words * 0.6 && lines >= 2) out.push(`[squeezed] ${desc(el)}: ${words} words on ${lines} lines (${Math.round(el.getBoundingClientRect().width)}px wide)`);
    }

    // 5. row consistency of buttons
    const isButton = (el: HTMLElement) => {
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") return true;
      if (el.tagName !== "A") return false;
      const cs = getComputedStyle(el);
      return cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0;
    };
    const byParent = new Map<Element, HTMLElement[]>();
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], [role=button]")) {
      if (!inScope(el) || !visible(el) || ignored(el) || !isButton(el) || !el.parentElement) continue;
      const pd = getComputedStyle(el.parentElement).display;
      if (!/flex|grid/.test(pd)) continue;
      byParent.set(el.parentElement, [...(byParent.get(el.parentElement) ?? []), el]);
    }
    for (const list of byParent.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i].getBoundingClientRect(), c = list[j].getBoundingClientRect();
          if (Math.abs(a.top - c.top) <= 4 && Math.abs(a.height - c.height) > 1) {
            out.push(`[row] ${desc(list[i])} (${Math.round(a.height)}px) and ${desc(list[j])} (${Math.round(c.height)}px) share a row with different heights`);
          }
        }
      }
    }

    // 6. alignment of text blocks inside cards/sections
    const containers = document.querySelectorAll<HTMLElement>("section, [data-card], main > div, main > section");
    const cards = [...containers].concat(
      [...document.querySelectorAll<HTMLElement>("div")].filter((d) => {
        const cs = getComputedStyle(d);
        return parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopLeftRadius) > 0;
      }),
    );
    for (const card of new Set(cards)) {
      if (!inScope(card) || ignored(card) || !visible(card)) continue;
      const ccs = getComputedStyle(card);
      const rowLike = (ccs.display.includes("flex") && !ccs.flexDirection.startsWith("column")) || ccs.display.includes("grid");
      if (rowLike) continue;
      const items: { el: Element; x: number }[] = [];
      for (const ch of card.children) {
        if (ignored(ch) || !visible(ch)) continue;
        const cs = getComputedStyle(ch);
        if (cs.display === "inline" || cs.display.includes("flex") && !cs.flexDirection.startsWith("column")) continue;
        if (cs.display.includes("grid") || ["UL", "OL", "BUTTON", "A", "INPUT", "SVG", "IMG"].includes(ch.tagName.toUpperCase())) continue;
        if (!/^(left|start)$/.test(cs.textAlign) || cs.marginLeft === "auto" || cs.transform !== "none") continue;
        const textNode = [...ch.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim());
        if (!textNode) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const q = range.getClientRects()[0];
        if (q) items.push({ el: ch, x: q.left });
      }
      if (items.length < 3) continue;
      const counts = new Map<number, number>();
      for (const it of items) counts.set(Math.round(it.x), (counts.get(Math.round(it.x)) ?? 0) + 1);
      const [mode, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n < items.length / 2 || n < 2) continue;
      for (const it of items) {
        if (Math.abs(it.x - mode) > 2) out.push(`[align] ${desc(it.el)} starts at x=${Math.round(it.x)} but its siblings in ${desc(card).slice(0, 20)} start at x=${mode}`);
      }
    }
    return out;
  }, project.startsWith("mobile"));
  expect(problems, `layout checks failed on "${name}" (${project})`).toEqual([]);
}

async function a11yChecks(page: Page, project: string, name: string) {
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  for (const sel of AXE_EXCLUDE) axe = axe.exclude(sel);
  if (AXE_DISABLED_RULES.length) axe = axe.disableRules(AXE_DISABLED_RULES);
  const { violations } = await axe.analyze();
  const bad = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `[a11y] ${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => `${n.html.slice(0, 90)} ${(n.any[0]?.message ?? "").slice(0, 110)}`).slice(0, 4).join(" | ")}`);
  expect(bad, `accessibility violations on "${name}" (${project})`).toEqual([]);
}

export const test = base.extend<Fx>({
  problems: async ({}, use) => use([]),
  calls: async ({}, use) => use([]),
  bodies: async ({}, use) => use([]),
  allowed: async ({}, use) => use([]),
  // Auto: every test fails on any uncaught console error, page error, failed or unmocked request.
  guard: [
    async ({ problems, allowed }, use) => {
      await use();
      const bad = problems.filter((p) => !allowed.some((re) => re.test(p)));
      expect(bad, "uncaught console errors / unmocked or failed requests").toEqual([]);
    },
    { auto: true },
  ],
  mock: async ({ page, problems, calls, bodies }, use) => {
    await use(async (m = {}) => {
      const json = (route: Route, body: unknown, status = 200) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

      // Catch-alls first (Playwright runs the last registered route first).
      await page.route((url) => url.hostname !== "127.0.0.1", (route) => {
        problems.push(`external request blocked: ${route.request().url()}`);
        return route.abort();
      });
      await page.route((url) => url.hostname === "127.0.0.1" && API_PATH.test(url.pathname), (route) => {
        const r = route.request();
        problems.push(`unmocked API request: ${r.method()} ${new URL(r.url()).pathname}`);
        return json(route, { error: "unmocked" }, 599);
      });
      await page.route("**/api/report*", (route) => {
        const r = route.request();
        calls.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);
        const rep = m.report as any;
        return rep && typeof rep === "object" && "status" in rep ? json(route, rep.body, rep.status) : json(route, rep ?? data.report);
      });
      await page.route("**/api/cogs", (route) => {
        const r = route.request();
        calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
        bodies.push(r.postDataJSON());
        const c = m.cogs ?? { status: 200, body: { ok: true } };
        return json(route, c.body, c.status);
      });
    });
  },
  shot: async ({ page }, use, testInfo) => {
    await use(async (name, opts) => {
      await page.mouse.move(0, 0); // park the pointer: a tap leaves a sticky :hover on touch emulation
      await page.waitForTimeout(300);
      const project = testInfo.project.name;
      await layoutChecks(page, project, name);
      await a11yChecks(page, project, name);
      const fullPage = !opts?.overlay;
      await page.screenshot({ path: `test-results/screens/${name}.${project}.png`, fullPage });
      // Approved baselines come only after the maintainer approves the screens (test:e2e:review skips this one line).
      if (process.env.E2E_BASELINE !== "skip")
        await expect(page).toHaveScreenshot(`${name}.${project}.png`, { fullPage, animations: "disabled" });
    });
  },
  page: async ({ page, problems }, use) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
    page.on("requestfailed", (req) => {
      if (req.url().startsWith("http://127.0.0.1")) problems.push(`request failed: ${req.url()}`);
    });
    await use(page);
  },
});

export { expect, data };
export type { Page };

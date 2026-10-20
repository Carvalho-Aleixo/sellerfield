// SellerField dashboard. Plain DOM, no framework. Text from the API (product titles come from Amazon) is only ever set with textContent.
const $ = (sel) => document.querySelector(sel);
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents) => usd.format(cents / 100);
const dateLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (profit, sales) => (sales > 0 ? `${((profit / sales) * 100).toFixed(1)}%` : "n/a");

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") el.textContent = v;
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.filter((k) => k != null));
  return el;
}
const tag = (text, cls = "") => h("span", { class: `tag ${cls}`.trim(), text });

const COLUMNS = [
  ["sales", "Sales"],
  ["fees", "Fees"],
  ["refunds", "Refunds"],
  ["ads", "Ads"],
  ["cogs", "Product cost"],
  ["profit", "Profit"],
];

let days = 30;
let data = null;

async function load() {
  const state = $("#state");
  state.textContent = "Loading…";
  $("#content").hidden = true;
  try {
    const res = await fetch(`/api/report?days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    state.replaceChildren(
      h("p", { text: "We could not load your profit. Try again in a moment." }),
      h("button", { type: "button", id: "retry", text: "Try again" }),
    );
    $("#retry").addEventListener("click", load);
    return;
  }
  render();
}

function render() {
  const { summary, demo } = data;
  $("#demo-note").hidden = !demo;
  if (!summary.skus.length) {
    $("#state").replaceChildren(h("p", { text: demo ? "The demo has no orders." : "No orders yet. Once Amazon is connected, your profit shows up here." }));
    $("#cost-note").hidden = true;
    $("#period").textContent = "";
    return;
  }
  $("#state").replaceChildren();
  $("#content").hidden = false;
  $("#period").textContent = `${dateLabel(data.from)} to ${dateLabel(data.to)}`;
  const missing = summary.skus.filter((s) => s.cogsMissing).length;
  const note = $("#cost-note");
  note.hidden = !missing;
  note.replaceChildren(`${missing} ${missing === 1 ? "product has" : "products have"} no unit cost, so its profit is overstated. Set it under `, h("a", { href: "#h-cogs", text: "Product costs" }), ".");
  renderTotals();
  renderChart();
  renderTable();
  renderCosts();
}

function renderTotals() {
  const a = data.summary.account;
  const cards = COLUMNS.map(([key, label]) => {
    const value = h("span", { class: `value${key === "profit" && a.profit < 0 ? " loss" : ""}`, text: money(a[key]) });
    const sub = key === "fees" && a.estimated ? h("span", { class: "sub", text: "includes estimates" })
      : key === "profit" ? h("span", { class: "sub", text: `${pct(a.profit, a.sales)} of sales` }) : null;
    return h("div", { class: `card${key === "profit" ? " total" : ""}` }, h("span", { class: "label", text: label }), value, sub);
  });
  $("#totals").replaceChildren(...cards);
}

function renderChart() {
  const chart = $("#chart");
  const daily = data.daily;
  const max = Math.max(1, ...daily.map((d) => d.profit));
  const min = Math.min(0, ...daily.map((d) => d.profit));
  const span = max - min;
  const zero = (max / span) * 100; // percent from the top where profit = 0
  const bars = daily.map((d, i) => {
    const bar = h("div", { class: "bar", title: `${dateLabel(d.day)}: ${money(d.profit)}${d.estimated ? " (fees estimated)" : ""}` });
    const height = (Math.abs(d.profit) / span) * 100;
    bar.style.left = `${(i / daily.length) * 100}%`;
    bar.style.width = `calc(${100 / daily.length}% - 1px)`;
    bar.style.height = `${height}%`;
    if (d.profit < 0) { bar.classList.add("loss"); bar.style.top = `${zero}%`; }
    else bar.style.top = `${zero - height}%`;
    if (d.estimated) bar.classList.add("est");
    return bar;
  });
  const line = h("div", { class: "zero" });
  line.style.top = `${zero}%`;
  chart.replaceChildren(line, ...bars);
  const best = daily.reduce((m, d) => (d.profit > m.profit ? d : m), daily[0]);
  chart.setAttribute("aria-label", `Profit per day, ${dateLabel(daily[0].day)} to ${dateLabel(daily.at(-1).day)}. Best day ${dateLabel(best.day)}, ${money(best.profit)}.`);
  $("#axis-from").textContent = dateLabel(daily[0].day);
  $("#axis-max").textContent = `Best day ${money(max)}`;
  $("#axis-to").textContent = dateLabel(daily.at(-1).day);
}

function sorted(skus) {
  const [key, dir] = $("#sort").value.split("-");
  const sign = dir === "asc" ? 1 : -1;
  return [...skus].sort((x, y) => (key === "sku" ? x.sku.localeCompare(y.sku) : (x[key] - y[key]) * sign));
}

function row(name, sub, t, tags = true) {
  const first = h("td", {}, h("span", { text: name }), sub ? h("span", { class: "sku", text: sub }) : null);
  const cells = COLUMNS.map(([key, label]) => {
    const td = h("td", { "data-label": label, class: key === "profit" && t.profit < 0 ? "loss" : "" });
    const value = h("span", {}, money(t[key]));
    if (key === "fees" && t.estimated && tags) value.append(tag("est."));
    if (key === "cogs" && t.cogsMissing && tags) value.append(tag("no cost", "warn"));
    td.append(value);
    return td;
  });
  cells.push(h("td", { "data-label": "Margin", text: pct(t.profit, t.sales) }));
  return h("tr", {}, first, ...cells);
}

function renderTable() {
  const { summary, products } = data;
  const head = h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Product" }), ...COLUMNS.map(([, l]) => h("th", { scope: "col", text: l })), h("th", { scope: "col", text: "Margin" })));
  const body = h("tbody", {}, ...sorted(summary.skus).map((s) => row(products[s.sku] ?? s.sku, s.sku, s)));
  body.append(row("Other", "Storage, subscription, Sponsored Brands, reimbursements", summary.other));
  const foot = h("tfoot", {}, row("Account total", null, summary.account, false));
  $("#skus").replaceChildren(head, body, foot);
  const skuProfit = summary.skus.reduce((n, s) => n + s.profit, 0);
  $("#reconcile").textContent = `Products ${money(skuProfit)} + Other ${money(summary.other.profit)} = Account ${money(summary.account.profit)}`;
}

function renderCosts() {
  const forms = Object.keys(data.products).sort().map((sku) => {
    const cost = data.cogs[sku];
    const msg = h("p", { class: "msg", "aria-live": "polite" });
    const price = h("input", { type: "number", inputmode: "decimal", min: "0", step: "0.01", required: "", "aria-label": `Unit cost in dollars for ${sku}` });
    price.value = cost ? (cost.unit_cost_cents / 100).toFixed(2) : "";
    const from = h("input", { type: "date", required: "", "aria-label": `Applies from, for ${sku}` });
    from.value = cost?.from_day ?? data.from;
    const form = h("form", {},
      h("div", { class: "who" }, h("b", { text: data.products[sku] }), h("span", { text: sku })),
      h("label", {}, h("span", { text: "Unit cost ($)" }), price),
      h("label", {}, h("span", { text: "From" }), from),
      h("button", { type: "submit", text: "Save" }),
      msg,
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.className = "msg";
      msg.textContent = "Saving…";
      const res = await fetch("/api/cogs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku, unit_cost_cents: Math.round(Number(price.value) * 100), from_day: from.value }),
      }).catch(() => null);
      if (res?.ok) {
        await load();
        const again = [...document.querySelectorAll(".cogs form")].find((f) => f.querySelector(".who span").textContent === sku);
        const m = again?.querySelector(".msg");
        if (m) m.textContent = "Saved. Profit is recalculated.";
      } else {
        msg.className = "msg err";
        msg.textContent = res ? ((await res.json().catch(() => ({}))).error ?? "Could not save.") : "Could not reach SellerField.";
      }
    });
    return form;
  });
  $("#cogs").replaceChildren(...forms);
}

for (const button of document.querySelectorAll(".range button")) {
  button.addEventListener("click", () => {
    days = Number(button.dataset.days);
    for (const b of document.querySelectorAll(".range button")) b.setAttribute("aria-pressed", String(b === button));
    load();
  });
}
$("#sort").addEventListener("change", () => data && renderTable());
load();

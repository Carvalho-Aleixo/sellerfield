-- SellerField v0.1 schema. Every table carries account_id (always 1 in v0.1).
-- Money is stored in cents (INTEGER); days are Pacific dates (YYYY-MM-DD).

CREATE TABLE products (
  account_id INTEGER NOT NULL DEFAULT 1,
  sku        TEXT NOT NULL,
  asin       TEXT,
  title      TEXT NOT NULL,
  PRIMARY KEY (account_id, sku)
);

CREATE TABLE orders (
  account_id INTEGER NOT NULL DEFAULT 1,
  order_id   TEXT NOT NULL,
  sku        TEXT NOT NULL,
  day        TEXT NOT NULL,
  units      INTEGER NOT NULL,
  item_sales_cents INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'shipped',  -- shipped | cancelled
  channel    TEXT NOT NULL DEFAULT 'afn',      -- afn | mcf | vine
  PRIMARY KEY (account_id, order_id, sku)
);
CREATE INDEX orders_day ON orders (account_id, day);

CREATE TABLE fee_events (
  account_id INTEGER NOT NULL DEFAULT 1,
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT,
  sku        TEXT,                              -- NULL = account-level (goes to Other)
  day        TEXT NOT NULL,
  kind       TEXT NOT NULL,                     -- referral | fba | other_order | storage | subscription | reimbursement
  amount_cents INTEGER NOT NULL,                -- positive = cost to the seller
  estimated  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX fee_events_day ON fee_events (account_id, day);

CREATE TABLE refunds (
  account_id INTEGER NOT NULL DEFAULT 1,
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL,
  sku        TEXT NOT NULL,
  day        TEXT NOT NULL,
  refunded_cents INTEGER NOT NULL,
  refunded_fees_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ad_spend (
  account_id INTEGER NOT NULL DEFAULT 1,
  day        TEXT NOT NULL,
  sku        TEXT,                              -- NULL = campaign-level (goes to Other)
  campaign_type TEXT NOT NULL,                  -- SP | SD | SB
  spend_cents INTEGER NOT NULL
);
CREATE INDEX ad_spend_day ON ad_spend (account_id, day);

CREATE TABLE cogs (
  account_id INTEGER NOT NULL DEFAULT 1,
  sku        TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  from_day   TEXT NOT NULL,
  PRIMARY KEY (account_id, sku, from_day)
);

CREATE TABLE settings (
  account_id INTEGER NOT NULL DEFAULT 1,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

CREATE TABLE sync_runs (
  account_id INTEGER NOT NULL DEFAULT 1,
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,                     -- orders | finances | ads
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status     TEXT NOT NULL,                     -- running | ok | error
  detail     TEXT
);

# Connect Amazon

SellerField reads your own Amazon data with your own API access. Nothing is shared, nothing is written back to Amazon: the only POST calls ask Amazon to build a report.

## What it reads

| Source | API | What it fills |
|---|---|---|
| Orders | Selling Partner API reports (`GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL`) | `orders`, `products` |
| Finances | Selling Partner API `financialEvents` | referral, FBA and other order fees, refunds, storage, subscription and reimbursements |
| Ads (optional) | Amazon Ads API v3 reports (`spAdvertisedProduct`, `sdAdvertisedProduct`, `sbCampaigns`) | `ad_spend` |

US marketplace only in v0.1.

## Set up

1. Register a private Selling Partner API app for your own seller account and authorise it. It needs the roles Orders, Finance and Reports (Amazon Fulfillment is not needed).
2. Optional, for ad spend: get Amazon Ads API access and a profile id. Without it, SellerField still works; ad spend can be imported later from the Ads console.
3. Put the values in the environment, for example an `.env` file next to the database (it is git-ignored):

```
SELLERFIELD_SP_CLIENT_ID=...
SELLERFIELD_SP_CLIENT_SECRET=...
SELLERFIELD_SP_REFRESH_TOKEN=...
SELLERFIELD_ADS_CLIENT_ID=...        # optional, all four or none
SELLERFIELD_ADS_CLIENT_SECRET=...
SELLERFIELD_ADS_REFRESH_TOKEN=...
SELLERFIELD_ADS_PROFILE_ID=...
```

4. Run `bun run sync 30` (the last 30 days; default 30). It prints one line per source and exits 1 if any failed. A source that fails does not stop the others. Run it again any time: it is safe to repeat.

Tokens are kept in memory only and never logged.

## How the numbers are built

- **Orders**: one row per order and SKU. Sales = item price (the line total) minus the promotion discount. Pending lines are skipped until they have a price. Multi-channel (`S01-`, "Non-Amazon" sales channel) lines are `mcf` and a shipped line priced 0 is `vine`; both are left out of profit.
- **Days** are Pacific dates (the Ads API already reports in the profile's time zone, which is Pacific for the US).
- **Fees**: Amazon's fee events, as costs. `Commission` is the referral fee, any `FBA...` type is the FBA fee, everything else on an order is `other_order`. Storage, subscription and other service fees have no order and go to Other. Service fee events carry no posting date, so they take the UTC day they were fetched in.
- **Estimated fees**: Amazon posts fee events a few days after the sale, and for some orders much later. A shipped order with no fee event yet gets an estimated referral and FBA fee from the same SKU's last 90 days (referral as a share of sales, FBA per unit) and is flagged `estimated`. The estimate disappears on the next sync once the real fee arrives. A SKU with no history gets no estimate, so its recent profit reads high until the fee posts.
- **Refunds**: the refunded principal, net of the fees Amazon gives back (the refund commission it keeps is not given back).
- **Ads**: Sponsored Products and Display by advertised SKU; Sponsored Brands by campaign, so it goes to Other.
- A sync replaces the fee, refund and ad rows of its window and updates orders by key, so repeating or overlapping syncs never double count.

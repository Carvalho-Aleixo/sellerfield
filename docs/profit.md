# Profit definition

Per SKU per Pacific day, from Amazon data only. Money in cents.

```
profit = item sales - fees - refunds (net of refunded fees) - ad spend - COGS
```

- Sales: item price minus the promotion discount.
- Fees: referral, FBA and other order fees on a SKU. Fees without a SKU, storage, subscription and reimbursements go to **Other**.
- Ads: Sponsored Products and Display spend per SKU. Sponsored Brands and campaign-level spend go to **Other**.
- COGS: units x the unit cost in force on the order day (latest `from_day` not after it). A SKU with no cost is flagged `cogsMissing`.
- Excluded: cancelled orders, MCF and Vine orders, `S01-` ids, and the fees and refunds of those orders.
- `estimated` marks a line that includes a fee Amazon has not confirmed yet.

The dashboard always shows `sum(SKU profit) + Other = account profit`.

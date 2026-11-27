# Google Ads — ready-to-run plan for DIY Inventory

Goal: buy high-intent traffic to turn into £29.99 report sales. The funnel already converts well; this adds volume.
Landing page built for this: **`/inventory-app`** (noindex, ads-only). Some ad groups point at existing pages instead.

Truth rules (keep ads compliant and honest): free to start, £29.99 to download, **no subscription, no VAT**. Never say it
"wins" disputes or is "approved/accepted by" any scheme. Clerk prices are "typical", never a named company.

---

## Before you switch on: conversion tracking (do this first)

Ads only works if Google can see which clicks become sales. Two ways:

1. **Simplest:** in Google Ads → Goals → Conversions → New → Website, create a conversion "Report purchased". Point it at
   the `/buy/done` page load (a sale always lands there). Mark it **Primary**. Add a secondary "Start report" on `/app`.
2. **Better (if GA4 is set up):** import the purchase event from GA4.

Until a conversion is recorded, run **Manual CPC** (cap ~£0.80–£1.20) so you don't overspend; switch to **Maximise
conversions** once you have ~15–30 recorded sales.

Budget to start: **£15–£20/day**, one country (UK), English. Review after 7 days and 2 weeks; kill losing keywords,
pour budget into the ad groups that produce sales.

---

## Campaign: "DIY Inventory — UK Search"

- Networks: **Search only** (turn OFF Display/Search partners to start).
- Locations: United Kingdom. Language: English.
- Ad schedule: all week (reports get done evenings/weekends).
- Bidding: Manual CPC at first, then Maximise conversions.

### Ad group 1 — Do-your-own inventory  → `/inventory-app`
Keywords (phrase match):
- "diy inventory"
- "do your own inventory"
- "inventory report app"
- "property inventory app"
- "check in report app"
- "tenancy check in app"
- "move in inventory app"

### Ad group 2 — Inventory clerk alternative  → `/inventory-clerk`
- "inventory clerk"
- "inventory clerk near me"
- "inventory clerk cost"
- "property inventory service"
- "check in inventory clerk"

### Ad group 3 — Check-in / check-out report  → `/inventory-app`
- "check in report"
- "check out report"
- "property check in report"
- "tenant check out report"
- "inventory and check in"

### Ad group 4 — Deposit evidence  → `/inventory-app`
- "deposit dispute inventory"
- "check out report for deposit"
- "evidence for deposit dispute"
- "tenant deposit inventory"

### Ad group 5 — Letting agents / landlords (bulk)  → `/agents`
- "inventory software for letting agents"
- "inventory app for landlords"
- "tenant check in software"
- "bulk inventory reports"

---

## Negative keywords (campaign level)

free, template free, word, excel, pdf template, jobs, job, salary, course, training, software developer, api,
furniture, stocktake, warehouse, business inventory, asset tracking, van, car, amazon, ebay, barcode

(We do sell a free *template*, but template-seekers rarely buy the £29.99 report — send them to organic, not ads.)

---

## Responsive Search Ads

Add **15 headlines** and **4 descriptions** per ad group; Google mixes them. Below is a strong set for ad groups 1/3/4
(the `/inventory-app` ones). Swap "inventory" wording for ad group 2 (clerk) and 5 (agents).

**Headlines (pin #1 to one that names the product):**
1. Do Your Own Inventory Report
2. Check-In Report On Your Phone
3. Professional PDF In Minutes
4. Free To Start · £29.99 To Download
5. Dated Photos, Room By Room
6. No Subscription · No VAT
7. Built For Deposit Disputes
8. Check-In, Check-Out & Inspections
9. Tenant Signs On Their Phone
10. Every Photo Date & Time Stamped
11. Send Your Tenant The Link
12. See An Example Report
13. Meters, Keys & Every Room
14. Made To Be Used As Evidence
15. Your Own Inventory, Done Today

**Descriptions:**
1. Walk round with your phone, sign, and download a professional PDF. Free to start, £29.99 to finish. No subscription.
2. Every photo carries the date and time inside the image. Meters, keys, tenant sign-off. Made as deposit evidence.
3. Do a check-in, check-out or inspection yourself in under an hour. Send your tenant a link to check and sign.
4. The report a clerk makes, without the clerk's fee. £29.99, no VAT, no subscription. Start free on your phone.

**Sitelinks (campaign):** See an example report (`/example-report`) · How it works (`/how-it-works`) · Pricing
(`/pricing`) · For letting agents (`/agents`).

**Callouts:** Free to start · No subscription · No VAT · Dated photos · Tenant sign-off · Deposit evidence.

---

## After launch

- Day 3: add any junk search terms (Search terms report) to negatives.
- Day 7: pause keywords with clicks and no sales; raise bids on sales-producers.
- Day 14: if an ad group is winning, ask me to build a tighter landing page variant for it to lift Quality Score.

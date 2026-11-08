# Mid-term inspection campaign kit

**The idea in one line:** *"Mid-term inspections without the visit. Send your tenant a link, get a dated report compared with the check-in. £29.99."*

Why it wins:
- It removes the landlord's biggest pain: the trip, the 24 hours' notice and the tenant's diary.
- It's the only offer where the tenant does it and the landlord still gets a compared, dated report.
- It's **recurring**: every let property needs 2–4 inspections a year, compared with one check-in.

---

## 1. What's live on the site
| Piece | Where |
|---|---|
| UK landing page | `/mid-term-inspection` (also `/midterm`, `/mid-tenancy-inspection`) |
| US landing page | `/us/routine-inspection` (shows dollar prices to US visitors) |
| Link that opens an inspection | `/app?start=inspection`; add `&from=<report key>` to start from that report |
| "Send the tenant the inspection link" | Finished screen of every check-in and inspection |
| Reminders every 3 or 6 months | Finished screen; emails carry the ready link; `/admin` → In progress → 🔁 Mid-term reminders |
| Tracking | Visits and sales funnel events `midterm_link` and `midterm_reminder` |

**Agent / tenant links:** change the end of an agent link from `&start=checkin` to `&start=inspection` and it opens a mid-term inspection, free for the tenant.

---

## 2. Audiences, in priority order
1. **Your own past customers** (people who did a check-in): the warmest audience, and the reminders do the work.
2. **Self-managing landlords** (UK): Facebook landlord groups, Property118, landlord associations (NRLA local branches).
3. **Small letting agents / property managers**: they inspect every 3–6 months and lose hours driving.
4. **US independent landlords** (1–10 doors): BiggerPockets, Facebook "landlord" groups, r/Landlord.
5. **Your own portfolio (Residential Realtors)**: use it on every managed property. It's free proof, and gives you real reports to show.

---

## 3. Email to past customers (UK)
*Send only to people who did a report with us and didn't opt out. Include an unsubscribe line.*

**Subject:** Your mid-term inspection, without the visit
**Preview text:** Send your tenant a link. Dated report in your inbox, compared with the check-in.

> Hi {first name},
>
> You did the check-in at {address} with DIY Inventory. Most landlords inspect every 3–6 months, but nobody enjoys arranging the visit.
>
> So skip it. Send your tenant this link and they'll do the inspection on their phone in about 20 minutes:
>
> **{inspection link}**
>
> The rooms and checklist from your check-in are already there. Every photo is dated and timed, and the report shows exactly what has changed since move-in, photos side by side.
>
> It's £29.99, only when you download the report. Want a reminder every 3 or 6 months? Tap "Remind me" on the finished report.
>
> DIY Inventory
> *Don't want these emails? Reply "stop".*

## 4. Email to letting agents (UK cold outreach, B2B)
**Subject:** Mid-term inspections without sending a negotiator

> Hi {name},
>
> How many hours a month does {agency} spend driving to mid-term inspections?
>
> With DIY Inventory, the tenant does the inspection from a link: a guided photo checklist, the date and time on every photo, and a PDF compared with the check-in, the same day. £29.99 per inspection, no subscription.
>
> I can set up a named link for {agency} so your tenants use it free and you see every report. Worth a 10-minute call?
>
> {your name}, DIY Inventory · diyinventory.co.uk/mid-term-inspection

---

## 5. Google Ads: UK
**Campaign:** Search · UK · Mid-term inspections · Landing page `/mid-term-inspection`

**Keywords** (phrase match):
"mid term inspection" · "mid term property inspection" · "mid tenancy inspection" · "periodic property inspection" · "routine property inspection" · "landlord property inspection" · "rental property inspection report" · "property inspection report template"
**Negatives:** jobs, course, salary, surveyor, homebuyer, mot, car

**Headlines** (≤30 characters each):
1. Mid-Term Inspections, £29.99
2. No Visit Needed
3. Your Tenant Does It by Link
4. Dated Photos, Every Room
5. Compared With the Check-In
6. Report Ready the Same Day
7. No Clerk, No Appointment
8. Free to Start, Pay at the End
9. Inspect Every 3–6 Months
10. Spot Damp and Leaks Early

**Descriptions** (≤90 characters each):
1. Send your tenant a link. They photograph each room; you get a dated PDF the same day.
2. Every item compared with the check-in, photos side by side. £29.99, no subscription.
3. Spot damp, leaks and damage early, with a dated record for the end of the tenancy.
4. Set a reminder every 3 or 6 months. The next inspection is one tap away.

## 6. Google Ads: US
**Campaign:** Search · US · Routine inspections · Landing page `/us/routine-inspection`

**Keywords:** "rental property inspection" · "routine rental inspection" · "mid lease inspection" · "landlord inspection checklist" · "rental inspection app" · "quarterly rental inspection"

**Headlines** (≤30 characters each):
1. Rental Inspections by Link
2. No Drive-Out, No Notice
3. Tenant Does It on Their Phone
4. Dated Photos of Every Room
5. Compared With Move-In
6. About $39 per Inspection
7. Free to Start

**Descriptions** (≤90 characters each):
1. Send your tenant a link: dated photos of every room, a PDF compared with move-in.
2. Catch leaks and mold early. A record that backs up security deposit deductions.

*Start with a small daily budget per country (e.g. £10/$10), and judge it on cost per paid report after 2–3 weeks.*

---

## 7. Social posts (ready to paste)
**Facebook landlord groups (UK)**, written as a helpful post rather than an ad:
> How do you all handle mid-term inspections? I've stopped visiting: I send the tenant a link, they photograph each room on their phone (it walks them through the check-in checklist), and I get a dated report showing what's changed since move-in. Tenants seem to prefer it to me turning up. Happy to share what I use if useful.

**LinkedIn (agents)**
> Mid-term inspections are a 2-hour round trip for a 20-minute job. We built a way for tenants to do them from a link: a guided checklist, dated photos, and a report compared with the check-in. £29.99 each, no subscription. → diyinventory.co.uk/mid-term-inspection

**Instagram / TikTok (short video idea):** a phone screen recording of the camera stepping through a room → "Inspection done. No visit. 20 minutes." → the PDF's "what changed" page.

**US (BiggerPockets / r/Landlord)**
> For routine inspections I send the tenant a link: they photograph every room, the app stamps date and time, and I get a PDF compared with the move-in report. No entry notice, no drive. Anyone else doing tenant-led inspections?

---

## 8. Calendar for the first month
| Week | Do this |
|---|---|
| 1 | Use it on 3–5 of your own managed properties. Keep the best report as a real example (with the tenant's OK). Email past customers (section 3). |
| 2 | Turn on Google Ads, UK first. Post in 3 landlord Facebook groups (section 7). |
| 3 | Email 20 small letting agents (section 4). Offer each a named tenant link with `&start=inspection`. |
| 4 | Turn on Google Ads in the US. Review: how many inspection links were sent, reminders set, paid inspections, cost per sale. |

**What to watch:** paid reports of type "Interim Inspection" on `/admin`, the `midterm_link` and `midterm_reminder` counts on Visits and sales, and active reminders under 🔁 Mid-term reminders.

**Rules to keep:** no VAT; never claim insurers or councils *require* inspections (say "some policies and licence conditions expect them"); in England the landlord gives at least 24 hours' written notice to visit, which a tenant-led inspection avoids.

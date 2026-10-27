# Research brief: council area data for diyinventory.co.uk

We are building a genuinely useful local hub for each council area (local authority district) in England (for landlords, tenants and agents doing inventories, check-ins and check-outs). Each page must be unique because of REAL, VERIFIED local facts. Accuracy matters more than completeness: if you can't verify a fact with a reliable source, set it to null. Never guess numbers. Today is 27 October 2026.

For each area you're given, use WebSearch / WebFetch (official sources first: the council's own website, ONS, gov.uk, Census 2021) and write `<work folder>/<slug>.json` (the work folder is given in your task) with exactly this shape:

```json
{
  "slug": "the slug from content/area-list.json",
  "name": "the name from content/area-list.json",
  "council": { "name": "Camden Council", "url": "https://www.camden.gov.uk", "privateRentingUrl": "council page for private renting / landlord licensing (verified URL)" },
  "licensing": {
    "selective": "Plain-English summary of selective licensing in force as at October 2026: whole area / which wards / none; start and end dates if known; or null if you can't verify",
    "additional": "Additional HMO licensing summary, same rules; or null",
    "fee": "Typical licence fee if stated on the council site, e.g. 'around £750 for a selective licence (2026)'; or null",
    "source": "URL you verified it on",
    "checked": "October 2026"
  },
  "rent": { "text": "Average private rent per month from the ONS Price Index of Private Rents (latest release you can find), e.g. '£2,450 a month (ONS, August 2026), up 4.1% on a year earlier'", "source": "URL" },
  "price": { "text": "Average house price from the UK House Price Index (latest), e.g. '£820,000 (UK HPI, July 2026)'", "source": "URL" },
  "privateRentedShare": { "text": "Share of households renting privately, Census 2021, e.g. '33% of households rent privately (Census 2021)'", "source": "URL" },
  "councilTax": { "text": "Average Band D council tax for 2026/27 in the area including county, police and fire precepts (the council's or gov.uk's published figure), e.g. '£2,310 average Band D (2026/27)'", "source": "URL" },
  "postcodes": ["NW1", "NW3", "NW5", "N6", "N7", "N19", "WC1"],
  "neighbourhoods": [
    { "name": "Kentish Town", "postcodes": "NW5", "housing": "One factual sentence about the typical homes there (e.g. Victorian terraces split into flats, council estates, new-build blocks)." }
  ],
  "housing": "3-4 sentences on the area's housing stock and rental market, specific to this area (period conversions, estates, towers, student lets, HMOs, regeneration areas…). Factual, no hype.",
  "checkinTips": [
    "4-6 practical things to check and photograph at check-in/check-out that follow from THIS area's typical homes (e.g. stone cottages and oil tanks in rural districts, student HMOs near a university, coastal damp and salt corrosion, flats over shops in town centres), e.g. 'Sash windows in the Georgian terraces: photograph cords, locks and any rot' or 'Communal entrances, lifts and bin stores in estate blocks: note fob and key counts'. Each one sentence, specific, not generic."
  ],
  "tenantHelp": "One or two sentences on where tenants in this area can get help from the council (e.g. its private housing / environmental health team for disrepair), with no phone numbers unless verified.",
  "nearby": ["islington", "westminster", "barnet", "haringey", "brent"]
}
```

Rules:
- 6-10 neighbourhoods per area: real towns, villages or districts in that area (for a city, its neighbourhoods), with their main postcode district(s).
- `nearby`: the bordering council areas, as slugs taken ONLY from `/home/user/DIY-Check-in/content/area-list.json` (the `slug` field). Use the slug and name exactly as given in that file for your own areas too.
- Licensing changes often (many areas have none beyond mandatory HMO licensing: then say so plainly, e.g. 'No selective licensing scheme.'): report only what the council's page (or a dated official notice) says is in force now, and note planned schemes as "planned/consulted on" with dates. If sources conflict, say so briefly or use null.
- Write in British English, plain words. No VAT mentions. Don't mention any letting agency by name.
- Valid JSON (double quotes, no comments, no trailing commas). Validate each file with `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`.

When done, reply with only: the files written, and per area any field you set to null.

## Search budget (important)
You have about 150 web searches in total, so spend at most 12 per area. WebFetch and curl can't reach websites from here: work from WebSearch results. Efficient order per area:
1. One search for the ONS "Housing prices in <area>" page: it gives both the average private rent and the average house price (and their months).
2. One search for the Census 2021 private renting share ("How life has changed in <area>: Census 2021").
3. One or two searches for council tax 2026/27 Band D.
4. Two or three searches for licensing (selective / additional HMO) on the council's own site.
Neighbourhoods, postcodes, housing, checkinTips, tenantHelp and nearby can come from your own knowledge (keep them factual and general; no invented specifics). Finish every area's file before moving on; if you're running low on searches, set the remaining unverified fields to null rather than stopping.

## Areas marked [file exists: fill the nulls]
A file for it is already in the work folder, with neighbourhoods, housing and tips written. Keep every non-null field as it is and research only the null ones (rent, price, privateRentedShare, councilTax, licensing, council.privateRentingUrl). About 5 searches per area.

## Total budget
Web searches are capped at about 200 per round for everyone together. Stay under 190 in total. Work through the areas in order and finish each file before the next.

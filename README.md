# Self Check-In Report

A tenant inventory tool. The tenant walks the property room by room, photographs
every item on a checklist, records keys and meter readings, signs a declaration,
and downloads a PDF report suitable for a deposit dispute.

Every photo carries the date and time burned into the image itself.

---

## Deploying to Railway

### 1. Put the files in a GitHub repository

Railway deploys from Git. Create a new repository, drop these files in at the
top level, and push:

```
package.json
server.js
railway.json
.gitignore
public/index.html
```

Do not commit `.env` or `node_modules`.

### 2. Create the Railway project

1. Go to railway.app and sign in.
2. **New Project → Deploy from GitHub repo**, and pick the repository.
3. Railway detects Node, runs `npm install`, then `npm start`. No settings to change.

If you prefer the CLI: `npm i -g @railway/cli`, then `railway login`,
`railway init`, `railway up` from this folder.

### 3. Set the variables

In the Railway project, open **Variables** and add:

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes, for condition assessment | Lets the server assess each photo. Get one at console.anthropic.com → API keys. |
| `ANTHROPIC_MODEL` | optional | Defaults to `claude-haiku-4-5-20251001`, the cheapest capable model. |

`PORT` is set by Railway automatically. Do not add it.

### 4. Generate the public URL

**Settings → Networking → Generate Domain.** That URL is what you send to tenants.
Under **Settings → Domains** you can point your own domain at it instead.

---

## Checking it worked

Visit `/api/status` on your deployed URL. You should see:

```json
{"ai":true,"reason":""}
```

- `"ai": false` means `ANTHROPIC_API_KEY` is missing or misspelled. The app still
  works; the tenant sets each condition by hand instead.

---

## What the app does

**Setup.** The tenant types the address as separate fields (flat, house/door number, building name, road, town, postcode), with a preview of exactly how it will read on the report.
inspector or tenant name, tenancy move-in date. Number of bedrooms and bathrooms,
plus common areas, which generates one checklist per room.

**Outside first.** The first photo is the front of the property from outside, showing the entrance and number. Nothing else can be photographed until it is taken, and it goes on the report cover.

**Rooms.** Each room has a checklist tailored to its type, at least 8 photos
required. Marking an item not applicable never takes a room below 8. Every item
needs a photo. The front door is mandatory and cannot be skipped. Each item shows guidance
on how to take the photo before it is taken, and the photo is checked in the
browser for focus and exposure the moment it is added.

**Condition.** With an API key set, each photo is assessed and the item is rated
New, Good, Fair or Poor with a written observation of what is visible. The worst
rating across an item's photos stands. The tenant can override it with "Change",
and always has a separate note box of their own. Without a key, the tenant picks
the rating from a dropdown.

**Keys, meters and sign-off.** Keys described and photographed, meter readings
typed and photographed, smoke and CO detectors recorded, then a declaration form.
The general property and decorative conditions are calculated from the individual
item ratings, so the summary always matches the detail.

**Review and sign.** Nothing can be signed until every room is complete. The
tenant confirms the honesty declaration and signs on screen.

**PDF.** Cover page with the report reference, a condition key, keys, meters,
detectors, then one section per room with the schedule of condition and the
photographs four across with their capture times, and the signed declaration.

---

## Costs

- **Railway**: the Hobby plan covers a tool at this scale. Usage-based beyond that.
- **Anthropic**: roughly a fifth of a penny per photo on Haiku. A 50-photo
  check-in costs around 10p.

---

## Notes

- The tenant's draft is held in the browser on their own device. When a report is
  finished, a copy of the PDF is sent to the server and stored on a Railway volume;
  the owner sees every report at `/admin`, protected by `ADMIN_PASSWORD`.
- Photos are sent to the assessment endpoint one at a time and are not retained.
- An unfinished report survives closing the browser and offers to resume.

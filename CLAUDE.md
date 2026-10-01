# CLAUDE.md

Self check-in / inventory report for tenants. Deployed on Railway from this repo (`npm start`, health check `/healthz`).

## Layout

- `public/index.html` is the whole client: HTML, CSS and one inline `<script>`. There is no build step, no bundler and no framework. Edit the file directly.
  - jsPDF 2.5.1 is loaded from cdnjs as a UMD script (`window.jspdf.jsPDF`). `buildPdfBlob(state, onProgress)` builds the report in the browser (A4 landscape, clerk report format).
  - The draft is kept in IndexedDB on the tenant's device. When a report is finished, `submitReport()` quietly saves a copy of the PDF with `POST /api/reports` (once per report: `state.submittedId`; retried when back online), so it is never lost. Finishing (signed and declared) then sends it straight away with `sendToAgent()` → `POST /api/reports/:id/send`, which marks it sent (`state.sentAt`), alerts the owner and emails it to Residential Realtors. No extra tap is needed: the finished screen's button only shows the progress, or **Try sending again** if it failed; it also retries when the connection returns or the report is reopened. Nothing else is stored on the server.
  - The PDF is delivered as a plain browser download (object URL + `<a download>`). Do not add `claude.*` / `window.claude` calls. The client only talks to this server's `/api/*` endpoints.
  - `preparePdf()` builds the PDF once per finished report and keeps it, so `savePdf()` / `openPdf()` / `sharePdf()` run straight from the tap (phones block downloads that start after the async build). Share uses the Web Share API only where `navigator.canShare` accepts files. A finished report stays in IndexedDB and reopens on the done screen until a new inspection is started.
  - Every photo in the PDF (cover, keys, meters, rooms) is drawn uncropped with `drawFitted()` from a smaller copy (`shrinkPhoto()`: 900 px, 1400 px on the cover). There are no full-size pages in the PDF: each photo, and its View link in the "Index of photographs" at the end, links to `/p/<photoKey>/<n>`, which shows it full size. `photoKey` is random per report (`ensurePhotoKey()`), `n` is the photo's order in the PDF; `buildPdfBlob(state, onProgress, out)` returns that list in `out.photos`, and `submitReport()` uploads the full-size photos after the PDF (`uploadPhotos()`, `state.photosUploaded`).
- Home-screen icon: `public/icons/` (drawn in `icon.svg`, exported to `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`, `favicon-32.png`) and `public/manifest.webmanifest` (name "Check-In", `display: browser` so it opens in the normal browser, keeping the camera and PDF downloads as they are). Re-export the PNGs if `icon.svg` changes.
- `server.js` is an Express app that serves `public/` and the API below. Any other path falls back to `public/index.html`.
- `reports.js` stores submitted reports as `<id>.pdf` + `<id>.json` in `REPORTS_DIR` (default: `$RAILWAY_VOLUME_MOUNT_PATH/reports`, i.e. the Railway volume at `/data`) and serves the owner's private list at `/admin` (sign-in page with the password in `ADMIN_PASSWORD`, then a signed HttpOnly cookie `diy_admin` that keeps that device signed in for a year, until Sign out or a password change; view, download, delete). Uploads must be PDFs (≤ 80 MB), are rate-limited per IP and de-duplicated by reference + finish time; deletes must come from the admin page (same-origin check); wrong passwords are rate-limited.
- The setup form takes the address as separate fields (one "Flat or house number" field, `houseNo`, e.g. "12" or "Flat 4"; building name, road, town, postcode), typed by the tenant, and joins them in UK order with `streetLineFrom()` (a number goes before the building name if there is one, otherwise before the road; "Flat 4" stands on its own). A postcode (valid UK format), the number, and a road or building name are required. The old separate `flat` field is still read from drafts saved before. There is no postcode lookup. Saved addresses on the device are split back into the fields with `splitAddressLine()`.
- Photos are taken with an in-app camera (`openCamera()`, `getUserMedia`) that stays open between shots and steps through the room's checklist (`roomTargets()`: each item, then General views); keys, meters and the outside photo use it too. Every photo, from the camera, the gallery or the phone's own camera, goes through `addPhotoFiles()` → `stampPhoto()`. If the camera can't be opened the tenant is offered the phone's own camera (`#photoInput`).
- Example pictures show tenants what to photograph. They are inline SVG drawings, with no image files. `exampleSVG(label)` picks a scene through `EX_RULES`, and each scene is usually a pair: the whole item, then a close-up. To keep the screens uncluttered they are not shown inline: every item card and the outside, keys and meters steps have a small "See example" link (`exampleThumbHTML()`) that opens the drawing with its tip (`showExample()` / `#exampleBox`), and the camera (`#camTip`) shows the tip as text only. The "How to take good photos" guide (`photoGuideHTML()`) at the top of the rooms screen starts closed; whether it is open is remembered in localStorage. When adding a checklist item, check that `exampleKeyFor(label)` maps it to a sensible scene.
- Each item records detail beyond its condition: a description (`desc`, typed or built from the `DETAIL_HINTS` chips for its kind of item), marks/damage (`defects`, from `DEFECT_OPTIONS`, or `['None']`), cleanliness (`clean`), whether it works (`working`, only for `WORKING_KEYS`), and a quantity (`qty`, for `QTY_KEYS` and custom items). All of these are optional and never block completion; `itemDetailsHTML()` renders them. In the PDF they fill the Description and Condition columns. The PDF also has a room-by-room overview table, a summary box at the top of each room, a "Property details & documents" page (`propertyType`, `documents` from `DOC_LIST`), and an index of every photograph with its time and a link to its page.
- **Start again** (`startAgain()`): a button in the top bar (`#restartBtn`, shown once an inspection has started) and on the finished screen. It always asks first (warning when a finished report hasn't been sent), then `confirmReset()` deletes the inspection from the device.
- The first photo of every inspection is the outside/front of the property (`state.property.exterior.photos`, shown first on the rooms screen). `exteriorFirst()` blocks room, key and meter photos until it exists, `updateFinishButtonState()` requires it, and it goes on the PDF cover page.

## API

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /api/status` | `initAI()` on boot | `{ ai, reason }` |
| `POST /api/assess` with `{ label, room, image }` (JPEG data URL) | `assessItemPhoto()` after each item photo | `{ matches, note, condition, observation, description, defects, cleanliness }`, with `condition` one of `new/good/fair/poor`, `defects` drawn from `DEFECT_OPTIONS` (kept in step with `DEFECTS` in `server.js`), `cleanliness` one of `clean/needs/dirty`. The client fills only the details the tenant hasn't set |
| `POST /api/reports`, body = the PDF (`application/pdf`), details in the `X-Report-Meta` header (URI-encoded JSON) | `submitReport()` when a report is finished | `201 { id }`, or `200 { id, duplicate: true }` for a repeat |
| `POST /api/reports/:id/photos` with `{ key, photos: [{ n, dataUrl, title, ts }] }` (up to 12 at a time) | `uploadPhotos()` after the PDF | `{ ok, saved }`. Stored in `REPORTS_DIR/<id>.photos/`. The key must match the report's `photoKey` (a report sent before photo links takes the key on its first upload) |
| `GET /p/:key/:n` and `/p/:key/:n.jpg` | links in the PDF | a page showing photo n full size with its title and time, and the JPEG. No sign-in: the random key is the access. Deleting the report deletes its photos |
| `POST /api/reports/:id/send` | `sendToAgent()` (the Send to Residential Realtors button) | `{ ok, sentAt, emailed }`. Marks the report sent and, with `RESEND_API_KEY`, emails it to `REPORT_TO_EMAIL` with the PDF attached (a link instead above 28 MB). Never emails the same report twice |
| `GET /admin`, `GET /admin/reports/:id.pdf[?download=1]`, `POST /admin/reports/:id/delete`, `POST /admin/upload` (PDF body, `X-Report-Meta`) | the owner, in a browser | the private report list, the PDF, delete, and adding a PDF they already have (details read from the app's file name `Address - Type - Date - Ref.pdf`; de-duplicated by file contents). All require `ADMIN_PASSWORD`; delete and upload also require the same origin |

`/health` and `/healthz` return `{ ok: true }`.

## Environment variables (set in Railway → Variables)

- `ANTHROPIC_API_KEY`: enables `/api/assess`. Without it `/api/status` reports `ai:false` and the tenant picks each condition by hand.
- `ANTHROPIC_MODEL`: optional. Defaults to `claude-haiku-4-5-20251001`.
- `ADMIN_PASSWORD`: the password for `/admin`. Without it `/admin` stays locked (reports are still received and stored).
- `RESEND_API_KEY`: emails each report to Residential Realtors when the tenant taps Send (resend.com). Without it reports are still marked sent and wait on `/admin`.
- `REPORT_TO_EMAIL`: optional, defaults to `jayk@residentialrealtors.co.uk`. `REPORT_FROM_EMAIL`: optional sender on a domain verified in Resend; the default `onboarding@resend.dev` only delivers to the Resend account's own address.
- `NTFY_TOPIC`: a phone alert (free ntfy app, ntfy.sh) the first time each report is sent by the tenant, with the address, who sent it and a link to the PDF. Subscribe to the topic in the ntfy app. `NTFY_SERVER` optional, defaults to `https://ntfy.sh`.
- `REPORTS_DIR`: optional override of where reports are stored. On Railway, reports need the volume attached to this service, or they are lost on the next deploy.
- `PORT` is set by Railway. Do not set it.

## Rules (must never regress)

1. Every checklist item that is not marked N/A needs at least one photo before its room can be completed.
2. Every room needs a minimum of 8 photos (`MIN_PHOTOS`). Marking an item not applicable must never bring a room's requirement below 8. The requirement is `max(active items, 8)`. The front door item is mandatory and cannot be marked N/A.
   A room can have at most `MAX_PHOTOS` (10) photos (`roomMaxPhotos()`). To keep every room completable, `roomPhotoSpace(room, item)` keeps one free slot for each other item still without a photo, and a room can have at most 10 items in use (adding an item or un-ticking N/A beyond that is refused). `addPhotoFiles()` and the camera enforce it; `notice()` explains why.
3. Every photo has the date and time burned into the image pixels at capture (`stampPhoto` draws it onto the canvas before encoding). A caption or metadata alone is not enough.
4. The report cannot be finished or produced without a signature drawn on the signature pad and the honesty declaration confirmed. `updateFinishButtonState()` / `completeReport()` enforce this.

## Testing

Any change to `public/index.html` must pass both of these before it is committed:

1. **Syntax:** extract the inline `<script>` and run `node --check` on it:
   ```sh
   node -e "const h=require('fs').readFileSync('public/index.html','utf8');require('fs').writeFileSync('/tmp/a.js',[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'))" && node --check /tmp/a.js
   ```
2. **PDF:** a jsdom run of `buildPdfBlob`. Load `public/index.html` in jsdom with the jsPDF UMD inlined in place of the CDN tag, stub `fetch` for the `/api/*` endpoints and stub canvas/Image, fill every room with photos and conditions, add the declaration and signature, then call `buildPdfBlob(state)`. Confirm it resolves, every page is A4 landscape (841.89 × 595.28 pt), and the rules above still hold.

For server changes: `npm install && npm start`, then `curl` `/`, `/healthz` and `/api/status`.

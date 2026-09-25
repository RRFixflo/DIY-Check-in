# CLAUDE.md

Self check-in / inventory report for tenants. Deployed on Railway from this repo (`npm start`, health check `/healthz`).

## Layout

- `public/index.html` is the whole client: HTML, CSS and one inline `<script>`. There is no build step, no bundler and no framework. Edit the file directly.
  - jsPDF 2.5.1 is loaded from cdnjs as a UMD script (`window.jspdf.jsPDF`). `buildPdfBlob(state, onProgress)` builds the report in the browser (A4 landscape, clerk report format).
  - The draft is kept in IndexedDB on the tenant's device. When a report is finished, `submitReport()` sends a copy of the PDF to `POST /api/reports` (once per report: `state.submittedId`; retried with Try again or when back online). Nothing else is stored on the server.
  - The PDF is delivered as a plain browser download (object URL + `<a download>`). Do not add `claude.*` / `window.claude` calls. The client only talks to this server's `/api/*` endpoints.
  - `preparePdf()` builds the PDF once per finished report and keeps it, so `savePdf()` / `openPdf()` / `sharePdf()` run straight from the tap (phones block downloads that start after the async build). Share uses the Web Share API only where `navigator.canShare` accepts files. A finished report stays in IndexedDB and reopens on the done screen until a new inspection is started.
  - Every photo in the PDF (cover, keys, meters, rooms) is drawn uncropped with `drawFitted()` and links to its own full-size page in the "Photographs – full size" section at the end, which links back. Each photo is embedded once (jsPDF image alias) and reused for the thumbnail and the full-size page.
- `server.js` is an Express app that serves `public/` and the API below. Any other path falls back to `public/index.html`.
- `reports.js` stores submitted reports as `<id>.pdf` + `<id>.json` in `REPORTS_DIR` (default: `$RAILWAY_VOLUME_MOUNT_PATH/reports`, i.e. the Railway volume at `/data`) and serves the owner's private list at `/admin` (HTTP Basic, password `ADMIN_PASSWORD`; view, download, delete). Uploads must be PDFs (≤ 80 MB), are rate-limited per IP and de-duplicated by reference + finish time; deletes must come from the admin page (same-origin check); wrong passwords are rate-limited.
- The setup form takes the address as separate fields (flat, house/door number, building name, road, town, postcode), typed by the tenant, and joins them in UK order with `streetLineFrom()`; a postcode (valid UK format), a flat or house/door number, and a road or building name are required. There is no postcode lookup. Saved addresses on the device are split back into the fields with `splitAddressLine()`.
- Photos are taken with an in-app camera (`openCamera()`, `getUserMedia`) that stays open between shots and steps through the room's checklist (`roomTargets()`: each item, then General views); keys, meters and the outside photo use it too. Every photo, from the camera, the gallery or the phone's own camera, goes through `addPhotoFiles()` → `stampPhoto()`. If the camera can't be opened the tenant is offered the phone's own camera (`#photoInput`).
- The first photo of every inspection is the outside/front of the property (`state.property.exterior.photos`, shown first on the rooms screen). `exteriorFirst()` blocks room, key and meter photos until it exists, `updateFinishButtonState()` requires it, and it goes on the PDF cover page.

## API

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /api/status` | `initAI()` on boot | `{ ai, reason }` |
| `POST /api/assess` with `{ label, room, image }` (JPEG data URL) | `assessItemPhoto()` after each item photo | `{ matches, note, condition, observation }`, with `condition` one of `new/good/fair/poor` |
| `POST /api/reports`, body = the PDF (`application/pdf`), details in the `X-Report-Meta` header (URI-encoded JSON) | `submitReport()` when a report is finished | `201 { id }`, or `200 { id, duplicate: true }` for a repeat |
| `GET /admin`, `GET /admin/reports/:id.pdf[?download=1]`, `POST /admin/reports/:id/delete`, `POST /admin/upload` (PDF body, `X-Report-Meta`) | the owner, in a browser | the private report list, the PDF, delete, and adding a PDF they already have (details read from the app's file name `Address - Type - Date - Ref.pdf`; de-duplicated by file contents). All require `ADMIN_PASSWORD`; delete and upload also require the same origin |

`/health` and `/healthz` return `{ ok: true }`.

## Environment variables (set in Railway → Variables)

- `ANTHROPIC_API_KEY`: enables `/api/assess`. Without it `/api/status` reports `ai:false` and the tenant picks each condition by hand.
- `ANTHROPIC_MODEL`: optional. Defaults to `claude-haiku-4-5-20251001`.
- `ADMIN_PASSWORD`: the password for `/admin`. Without it `/admin` stays locked (reports are still received and stored).
- `REPORTS_DIR`: optional override of where reports are stored. On Railway, reports need the volume attached to this service, or they are lost on the next deploy.
- `PORT` is set by Railway. Do not set it.

## Rules (must never regress)

1. Every checklist item that is not marked N/A needs at least one photo before its room can be completed.
2. Every room needs a minimum of 8 photos (`MIN_PHOTOS`). Marking an item not applicable must never bring a room's requirement below 8. The requirement is `max(active items, 8)`. The front door item is mandatory and cannot be marked N/A.
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

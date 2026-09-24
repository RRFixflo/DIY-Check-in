# CLAUDE.md

Self check-in / inventory report for tenants. Deployed on Railway from this repo (`npm start`, health check `/healthz`).

## Layout

- `public/index.html` is the whole client: HTML, CSS and one inline `<script>`. There is no build step, no bundler and no framework. Edit the file directly.
  - jsPDF 2.5.1 is loaded from cdnjs as a UMD script (`window.jspdf.jsPDF`). `buildPdfBlob(state, onProgress)` builds the report in the browser (A4 landscape, clerk report format).
  - The draft is kept in IndexedDB on the tenant's device. Nothing is stored on the server.
  - The PDF is delivered as a plain browser download (object URL + `<a download>`). Do not add `claude.*` / `window.claude` calls. The client only talks to this server's `/api/*` endpoints.
- `server.js` is an Express app that serves `public/` and the API below. Any other path falls back to `public/index.html`.

## API

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /api/status` | `initAI()` on boot | `{ ai, reason, addressLookup }`, where `addressLookup` is `"full"` or `"postcode-only"` |
| `POST /api/assess` with `{ label, room, image }` (JPEG data URL) | `assessItemPhoto()` after each item photo | `{ matches, note, condition, observation }`, with `condition` one of `new/good/fair/poor` |
| `GET /api/postcode/:postcode` | `lookupPostcode()` | `{ postcode, addresses[] }` with getAddress.io, otherwise `{ postcode, ward, district, addresses: [] }` from postcodes.io |

`/health` and `/healthz` return `{ ok: true }`.

## Environment variables (set in Railway → Variables)

- `ANTHROPIC_API_KEY`: enables `/api/assess`. Without it `/api/status` reports `ai:false` and the tenant picks each condition by hand.
- `GETADDRESS_API_KEY`: optional. Enables full street-level address lookup. Without it, postcodes are only validated.
- `ANTHROPIC_MODEL`: optional. Defaults to `claude-haiku-4-5-20251001`.
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
2. **PDF:** a jsdom run of `buildPdfBlob`. Load `public/index.html` in jsdom with the jsPDF UMD inlined in place of the CDN tag, stub `fetch` for the three `/api/*` endpoints and stub canvas/Image, fill every room with photos and conditions, add the declaration and signature, then call `buildPdfBlob(state)`. Confirm it resolves, every page is A4 landscape (841.89 × 595.28 pt), and the rules above still hold.

For server changes: `npm install && npm start`, then `curl` `/`, `/healthz` and `/api/status`.

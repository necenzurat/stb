# stb.nece.ro 

An independent, map-first view of Bucharest public transport. It is designed
for the quick question at a stop: which lines are nearby, where do they go,
and what is arriving next?

The app uses a dark MapLibre cartography style and proxies requests to the public
InfoTB service through the same origin. It is not affiliated with STB or
InfoTB.

## What it does

- Shows nearby stops and the lines serving them.
- Displays a selected line's route, stops, direction, and live vehicles.
- Adds vehicle plate, passenger count, and data freshness from the cached mo-bi feed.
- Shows arrival information for a tapped stop.
- Uses the browser's location when available, with central Bucharest as a
  fallback.
- Keeps the map usable on mobile with compact, high-contrast controls.

## Run locally

The local Node server serves the static app and forwards `/api/*` requests to
`info.stb.ro`. The proxy owns the InfoTB device/auth headers, decodes protobuf
transit responses, and returns JSON to the browser. Optional `STB_APP_ID`,
`STB_APP_KEY`, and `STB_USER_INFO` environment variables can provide stable
server credentials. Optional `MOBI_API_URL`, `MOBI_CACHE_TTL_MS`, `MOBI_STALE_TTL_MS`, and `MOBI_TIMEOUT_MS` configure the server-side mo-bi vehicle enrichment cache.

```bash
npm start
```

Open [http://localhost:8001](http://localhost:8001). Set `PORT` to use a
different local port:

```bash
PORT=3000 npm start
```

No build step is required.

## Deploy to Cloudflare Workers

The Worker entry point is `src/index.js`; static assets are in `public/`.
The included `wrangler.json` contains the Worker and custom-domain
configuration. After authenticating the Wrangler CLI for the intended
Cloudflare account, deploy with:

```bash
npx wrangler deploy
```

For local Worker development, use:

```bash
npx wrangler dev
```

## Project layout

```text
public/index.html  Browser application and map UI
src/index.js       Cloudflare Worker: static assets and API proxy
src/protobuf.js    Shared protobuf-to-JSON decoder
src/upstream-auth.js Shared server-owned InfoTB credentials
src/vehicle-enrichment.js Cached mo-bi vehicle enrichment
server.js          Local static server and API proxy
wrangler.json      Cloudflare Worker configuration
API.md             Reverse-engineered InfoTB API reference
PRODUCT.md         Product and design direction
```

## Data and privacy

Location access is requested only in the browser to centre the map near the
rider. The app contacts its same-origin `/api/` proxy, which forwards transit
requests to `info.stb.ro`. Map rendering also loads MapLibre and map tiles from
their configured public providers. Transit information, vehicle positions, and
arrival times are dependent on the upstream service and may be unavailable or
delayed. Vehicle enrichment is fetched server-side from `https://mo-bi.ro/python_api`,
cached, and never requested directly by the browser. Passenger values can be
null or stale; the UI labels their age.

## Development notes

`API.md` documents the observed InfoTB requests and protobuf payloads used by
the client. Treat it as implementation reference rather than an official API
contract. Please keep changes focused on a glanceable, accessible, map-first
experience for riders.

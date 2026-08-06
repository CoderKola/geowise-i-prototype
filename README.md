# geowise-i-prototype

Cross-platform GPS location logger — phased prototype for a geo-telemetry app.

Phone records GPS → stores locally in SQLite → auto-uploads through a Cloudflare
tunnel to a laptop ingest server → live web dashboard shows the track on a map.

## Repo layout (monorepo)

```
apps/
├── mobile/   React Native + Expo SDK 54 app (records GPS, uploads, CSV export)
├── server/   Node ingest server (SQLite) + local-only dashboard feed
└── web/      Vite + React + Tailwind + shadcn-style live dashboard (Leaflet map)
```

## Requirements (install once)

| Tool | Why | Install |
|---|---|---|
| Node.js 20+ | runs everything | `node -v` to check |
| **Expo Go** app on the phone | runs the mobile app (SDK **54** — pinned, do not bump) | App Store |
| **cloudflared** | temporary HTTPS tunnel phone → laptop | `brew install cloudflared` |

One-time setup:

```bash
# server secret (must match the token you enter in the app's Settings tab)
cd apps/server && cp .env.example .env   # then edit UPLOAD_TOKEN (openssl rand -hex 24)

# dependencies
cd apps/mobile && npm install
cd apps/server && npm install
cd apps/web    && npm install
```

## Running it — 4 terminals, in this order

**Terminal 1 — ingest server** (receives points; also serves the dashboard feed)

```bash
cd apps/server
npm start
# → ingest on 127.0.0.1:3000 (tunneled, auth-gated)
# → dashboard feed on 127.0.0.1:3100 (LOCAL ONLY, never tunneled)
```

**Terminal 2 — Cloudflare tunnel** (public HTTPS entry for the phone)

```bash
cloudflared tunnel --url http://localhost:3000
# → prints https://<random-words>.trycloudflare.com
# The random-words part is the "tunnel name" you paste into the app's Settings tab.
# It CHANGES every time you restart cloudflared — re-paste it each session.
```

**Terminal 3 — mobile app** (Metro dev server; phone loads the app from here)

```bash
cd apps/mobile
npx expo start --tunnel     # drop --tunnel if phone + laptop share WiFi and it works
# → scan the QR with the iPhone camera → opens in Expo Go
```

**Terminal 4 — web dashboard**

```bash
cd apps/web
npm run dev
# → open http://localhost:5173 in the laptop browser
```

**Then on the phone:** Settings tab → paste tunnel name + token → Save →
Track tab → choose Auto (or Manual + "Sync now") → **Start tracking** → move.
Points appear in Terminal 1's log and draw live on the dashboard map.

## Security model

- The **only** public surface is the tunnel → `POST /points` on :3000, which requires
  `Authorization: Bearer <UPLOAD_TOKEN>` and strictly validates every field
  (unknown fields, bad ranges, oversized bodies → rejected).
- The dashboard feed (:3100, sessions/points/live stream) binds to **127.0.0.1 only**
  and is **never** exposed through the tunnel — live GPS stays on the laptop.
- Both server listeners are loopback-bound; nothing is reachable from the LAN.

## Notes & gotchas

- A GPS distance-logger saves a point every **~10 m of movement** — standing still
  looks idle but recording is live. Test by walking/driving.
- The phone keeps its screen awake while tracking (foreground-only app; lock = stop).
- Inspect server data directly: `sqlite3 apps/server/geowise-ingest.db 'select count(*) from points;'`
- Wipe server data for a clean demo: stop the server, delete
  `apps/server/geowise-ingest.db*`, restart.
- Mobile is **pinned to Expo SDK 54** (device Expo Go cap) with exact-pinned deps
  (`.npmrc save-exact`). Add Expo packages with `npx expo install <pkg>`, then pin exact.
```

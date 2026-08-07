# geowise-i-prototype

Android-first GPS telemetry app — phased prototype.

Phone records GPS + dashcam-style ride video (15s chunks) → stores both locally in
SQLite → auto-uploads through a Cloudflare tunnel to a laptop ingest server → live
web dashboard shows the track on a map with near-live video, and replays sessions
with video and GPS stitched to one timeline.

**Platform strategy:** Android is the product target — all real testing happens on
sideloaded **EAS APK builds** (background tracking, camera, background sync are
Android features). The iPhone is a dev convenience only: Expo Go gives a fast
edit-reload loop with foreground-only tracking. No iOS builds are planned.

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
| **Expo Go** app on the phone | dev only (foreground tracking); real builds are Android APKs. SDK **54** — pinned, do not bump | App Store / Play Store |
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

## Building the Android APK — the primary testing channel

Real testing happens on a standalone APK: background tracking, camera recording,
and background sync only work there (Expo Go can't do them — the app detects Expo
Go and falls back to foreground-only).

These are **one-shot commands** — run them in any free terminal; they exit when
done. The compile happens on Expo's cloud (EAS), so no Android Studio is needed.
The resulting APK is standalone: the JS is bundled in, the tester never connects
to Metro. They only need the tunnel URL + token in Settings.

```bash
cd apps/mobile
npx eas-cli login                                    # once per machine (free expo.dev account)
npx eas-cli build --platform android --profile preview
# → ~10-15 min in the cloud → prints a download link/QR
# Send the link to the tester → they open it on the phone and sideload.
```

On first Start the tester must grant location **"Allow all the time"**.

### Keep long rides alive: battery settings

The app prompts once for a **battery-optimization exemption** (tap "Allow
unrestricted battery use" on the Track tab). On stock Android that's enough.
Samsung and Xiaomi layer their own app killers on top — set these once per
device or hours-long rides can stop silently
(see [dontkillmyapp.com](https://dontkillmyapp.com/) for the full per-vendor guide):

- **Samsung:** Settings → Battery → Background usage limits → make sure the app
  is **not** in "Sleeping apps"/"Deep sleeping apps"; add it to "Never sleeping apps".
- **Xiaomi (MIUI):** Settings → Apps → the app → Battery saver → **No restrictions**,
  and enable **Autostart**.

## Quick dev loop — 4 terminals, in this order

For iterating on the app itself. The phone runs the JS from Metro via Expo Go
(foreground-only tracking); everything hot-reloads on save.

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
# → scan the QR (iPhone camera, or "Scan QR code" inside Expo Go on Android)
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
- **In Expo Go** the app is foreground-only: it keeps the screen awake while tracking
  (lock = stop). **In the APK build** it records in the background — screen off,
  app switched away — behind a persistent notification, and syncs opportunistically.
- Inspect server data directly: `sqlite3 apps/server/geowise-ingest.db 'select count(*) from points;'`
- Wipe server data for a clean demo: stop the server, delete
  `apps/server/geowise-ingest.db*`, restart.
- Mobile is **pinned to Expo SDK 54** (the dev iPhone's Expo Go cap) with exact-pinned
  deps (`.npmrc save-exact`). Add Expo packages with `npx expo install <pkg>`, then pin exact.

## Dev workflow glossary

The three apps each run a dev server. You don't stare at the server — it feeds the
thing you actually look at (phone or browser) and hot-reloads on save.

| Term | What it is |
|---|---|
| **Metro** | React Native's JS bundler + dev server (`npx expo start`, port 8081). Bundles `apps/mobile` and serves it to Expo Go on the phone; hot-reloads on save. This is the "Metro on 8081" you'll see. |
| **Expo Go** | The app on the phone that loads your bundle from Metro (via QR). No native build needed — the native modules are baked into Expo Go, which is why the SDK must match (54). Dev loop only; the product runs as an APK. |
| **EAS** | Expo Application Services — cloud build farm. `npx eas-cli build --platform android --profile preview` compiles the standalone APK. |
| **Vite** | The web dashboard's bundler + dev server (`npm run dev`, port 5173). Same idea as Metro, for `apps/web`. Open it in the laptop browser. |
| **cloudflared** | Cloudflare's tunnel client. Exposes the laptop ingest (:3000) at a temporary public `https://…trycloudflare.com` URL so the phone can reach it over cellular. |
| **`--clear`** | `npx expo start --clear` wipes Metro's cache. Use it after installing a new native package if something renders stale (missing icons/fonts). |

**Stopping a dev server:** Ctrl+C in its terminal. Metro/Vite keep running until you do.

## Documentation

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased plan: what's built, what's next.

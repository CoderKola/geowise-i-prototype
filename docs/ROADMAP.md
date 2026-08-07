# geowise — Roadmap

An Android-first GPS telemetry app: the phone records location and dashcam-style
ride video, buffers both durably on-device, and (optionally) streams them to a
server with a live map + video dashboard.
Android (EAS APK builds) is the product target; the iPhone stays useful only as an
Expo Go dev device with foreground-only tracking.

Each phase is **additive** — the on-device SQLite schema laid down in Phase 1 is never
rewritten; later phases read from it and add pipes, tables, and surfaces. The product
is usable at the end of every phase.

**Legend:** ✅ shipped · 🟡 partial · ⬜ planned

---

## Data model (stable across all phases)

```
sessions (parent)            points (child)
─────────────────            ───────────────────────────────
session_id (PK)   ◄────────┐ point_id (PK)
device_id                  └ session_id (FK)
started_at                   timestamp, lat, lon, accuracy,
ended_at                     altitude, speed, bearing,
label                        device_battery, + sensor fields,
                             uploaded (0/1)

media_segments (child, added in Phase 2.5)
───────────────────────────────────────────
segment_id (PK), session_id (FK), facing,
started_at, ended_at, file_uri, size_bytes,
uploaded (0/1)
```

A **session** is one Start→Stop trip — the human-meaningful unit. Time-range questions
are answered by querying, not by storing arbitrary time buckets. One CSV export = one
session.

---

## Phase 1 — Foreground capture ✅

The proof of concept, fully in Expo Go.

- ✅ Tap **Start** → begins a session and records GPS; **Stop** → closes it
- ✅ Distance-based sampling (~10 m of movement per point)
- ✅ Live on-screen telemetry: speed (mph), lat/lon, altitude, heading (compass), accuracy, battery, point count
- ✅ Durable local store (SQLite) — crash-safe, queryable
- ✅ **Export** one CSV per session via the native share sheet
- ✅ Screen kept awake while tracking (foreground-only; lock = stop)
- ✅ Extended per-point capture: altitude accuracy, barometric pressure/relative altitude, charging state, network type
- ✅ One codebase: Android is the product target; iOS runs dev-only via Expo Go

**Known limit:** the app must stay open/on-screen. No background tracking yet.

---

## Phase 2 — Secure upload + live dashboard 🟡

Move from manual CSV to an automatic pipe, plus a browser view. Foreground-only for now.

- ✅ Offline-safe upload queue: points buffer in SQLite (`uploaded` flag), flush when reachable
- ✅ **Auto / Manual** sync modes in-app, with pending/sent counters
- ✅ Ingest server (local, Node + SQLite): token-authenticated, strict payload validation, idempotent inserts
- ✅ Transport over a temporary public HTTPS tunnel
- ✅ **Live web dashboard**: map with track polyline + following marker, trip stats, session switcher, real-time updates
- ✅ **Least-exposure design:** only the auth-gated write endpoint is public; the dashboard feed is bound to localhost and never exposed
- ✅ **Background tracking** — record while backgrounded / screen-off, via `expo-task-manager` + `startLocationUpdatesAsync` (Android foreground service / iOS location background mode). Requires a custom (EAS) build; in Expo Go the app auto-falls back to the foreground + keep-awake path, so the pinned iPhone keeps working unchanged
- ✅ **Device identity on every point** — platform, model, device type (phone/tablet/…), OS version captured via `expo-device` and carried through SQLite → upload → server → CSV
- ✅ **Background sync** — mid-ride upload piggybacks on the location task (~1/min); an OS-scheduled flush (WorkManager, ~15 min floor) drains the queue even after the app is backgrounded or killed
- ✅ **Battery-optimization exemption prompt** — one-tap system dialog on the Track tab (plus README guide for Samsung/Xiaomi app killers)
- ✅ **Storage hygiene** — phone deletes segment files only after a confirmed upload and a 24 h grace window; un-synced data is undeletable by construction
- ⬜ **Battery-aware capture** — stop-detection, accuracy tiers, and generous distance/time/angle filters so the GPS chip can idle when stationary

**Known limit:** the server runs on a laptop behind a temporary tunnel — the public
URL rotates on restart.

---

## Phase 2.5 — Ride video (dashcam) + stitched replay 🟡

Camera capture on the phone, near-live video on the dashboard, and a replay where
video and GPS are one timeline.

- ✅ **Segmented capture** — 15 s MP4 chunks at 720p/3 Mbps, dual-camera (front + back) when the hardware supports it; camera always on while tracking, never blocks GPS
- ✅ **Offline-safe media queue** — chunks buffer in SQLite (`media_segments`) and upload through the same ack-before-mark pipe as points; server inserts idempotent (retried uploads discarded)
- ✅ **Dashboard console redesign** — full-bleed square-edged layout: sessions rail, edge-to-edge map with always-on metrics HUD, fixed camera rail (Front 1 / Front 2 / Center), playback bar inside the map
- ✅ **Stitched replay** — bidirectional video↔GPS sync: scrubbing a video tile (full-session scrubber) moves the map tracker; while playing, the rendered frame IS the clock, so they cannot drift. Per-tile wall-clock + drift overlay for at-a-glance sync confidence
- ✅ **Feed freshness indicator** — LIVE / STALE / OFFLINE with "x ago", separating "phone gone quiet" from "feed unreachable"
- ✅ **Windowed prefetch** — small sessions fully preloaded; large sessions keep a sliding window of chunks around the playhead (bounded browser memory)
- 🟡 **Screen-off video capture (experimental spike)** — camera-type foreground service + patched vision-camera lifecycle keep-alive, flag-gated in `camera.ts`; ships ON in the current test APK, awaiting on-device validation (GPS is screen-off-safe regardless; chunks finalize gracefully on failure)

**Known limits:** video pauses while the screen is off unless the spike proves out;
chunk boundaries lose ~0.3 s (native recorder restart breather); dashboard preloads
assume the local feed.

---

## Phase 3 — Production backend ⬜

Graduate from "laptop + temporary tunnel" to something always-on and shareable.

- ⬜ Always-on hosted backend + database (stable URL, no per-session re-paste)
- ⬜ Real authentication and multi-device / multi-user separation (replace the single shared token)
- 🟡 Remote-colleague distribution of the app itself:
  - ✅ **Android: EAS preview build → sideloadable APK** (install link/QR, no store, no Google account) — the viable testing channel now
  - ✖️ iOS: not planned — Android-first; the iPhone remains an Expo Go dev device only (no TestFlight, no Apple Developer account)
- ⬜ Dashboard hosted alongside the backend, access-controlled

**Server language:** the backend stays **Node** — the right fit for real-time
ingest/streaming, and it shares TypeScript with mobile and web. **Python is
earmarked for analysis, scoring, and data tooling** when Phase 4 lands.

---

## Phase 4 — Safety telemetry ⬜

Turn the GPS track into driver-safety signal.

- ⬜ Read accelerometer / gyroscope to detect **harsh braking, hard acceleration, and crashes**, plus a manual **SOS**
- ⬜ Each event stamped with the current GPS point + timestamp, stored in a separate `events` table that joins cleanly to the track
- ⬜ Live in-app alerts; events flow through the Phase-2/3 upload pipe
- ⬜ Foundation for driver scoring and safety dashboards — analysis/scoring tooling
  to be built in **Python** (separate from the Node ingest server)

*(Can be pulled earlier than Phase 4 if priorities shift.)*

---

## Cross-cutting constraints

- **Expo SDK is pinned to 54** because the owner's iPhone — the Expo Go dev device —
  caps at SDK 54. The pin exists solely for that dev loop; bumping it is a deliberate
  decision, not a routine upgrade.
- **Dependency versions are locked exact** (`.npmrc save-exact`) across all apps for
  reproducible builds.
- **Background tracking, camera recording, and background sync are Android-only product
  features** — they require the EAS APK build (`eas.json` preview profile). The app
  detects Expo Go at runtime and falls back to foreground-only, which keeps the pinned
  iPhone dev loop working unchanged. No iOS builds are planned.
- **Toolchain note:** the newer Node on the dev machine breaks the SDK-54 CLI/build path
  (Metro dev server is fine). Standalone builds / EAS in Phase 3 will need Node 20.

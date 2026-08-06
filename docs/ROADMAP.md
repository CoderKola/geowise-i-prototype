# geowise — Roadmap

A cross-platform GPS telemetry app: the phone records location, buffers it durably
on-device, and (optionally) streams it to a server with a live map dashboard.

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
- ✅ Runs on iOS + Android from one codebase

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
- ⬜ **Background tracking** — record while backgrounded / screen-off (requires a dev/prebuild client; iOS enforces platform limits)
- ⬜ **Battery-aware capture** — stop-detection, accuracy tiers, and generous distance/time/angle filters so the GPS chip can idle when stationary

**Known limit:** upload runs only while the app is foreground. The server runs on a
laptop behind a temporary tunnel — the public URL rotates on restart.

---

## Phase 3 — Production backend ⬜

Graduate from "laptop + temporary tunnel" to something always-on and shareable.

- ⬜ Always-on hosted backend + database (stable URL, no per-session re-paste)
- ⬜ Real authentication and multi-device / multi-user separation (replace the single shared token)
- ⬜ Remote-colleague distribution of the app itself: standalone builds (iOS via TestFlight, Android via installable package) instead of the dev preview
- ⬜ Dashboard hosted alongside the backend, access-controlled

---

## Phase 4 — Safety telemetry ⬜

Turn the GPS track into driver-safety signal.

- ⬜ Read accelerometer / gyroscope to detect **harsh braking, hard acceleration, and crashes**, plus a manual **SOS**
- ⬜ Each event stamped with the current GPS point + timestamp, stored in a separate `events` table that joins cleanly to the track
- ⬜ Live in-app alerts; events flow through the Phase-2/3 upload pipe
- ⬜ Foundation for driver scoring and safety dashboards

*(Can be pulled earlier than Phase 4 if priorities shift.)*

---

## Cross-cutting constraints

- **Expo SDK is pinned to 54** to match the primary test device's Expo Go. Bumping it is
  a deliberate decision, not a routine upgrade.
- **Dependency versions are locked exact** (`.npmrc save-exact`) across all apps for
  reproducible builds.
- **Background tracking is the boundary** between "pure Expo Go" (Phases 1–2 foreground)
  and needing a custom dev/prebuild client. iOS background location is a hard platform
  wall regardless of tooling.
- **Toolchain note:** the newer Node on the dev machine breaks the SDK-54 CLI/build path
  (Metro dev server is fine). Standalone builds / EAS in Phase 3 will need Node 20.

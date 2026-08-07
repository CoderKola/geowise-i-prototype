# apps/server — agent instructions

Root `AGENTS.md` applies; this file adds server-only rules.

Node + Express + SQLite (`better-sqlite3`-style sync access via `db.js`). Two
listeners with a deliberate security split — do not break these invariants:

## Security invariants

- **Ingest (:3000) is the only tunneled surface.** It is auth-gated
  (`Authorization: Bearer <UPLOAD_TOKEN>`) and write-only from the phone's
  perspective. Nothing else may ever be exposed through the tunnel.
- **The dashboard feed (:3100) binds to 127.0.0.1 only and is never exposed** —
  not through the tunnel, not on the LAN. Live GPS stays on the laptop. Do not
  add listen addresses, proxies, or CORS origins beyond local dev
  (`localhost`/`127.0.0.1`).
- **Strict payload validation stays strict.** The zod schemas in `schema.js`
  reject unknown fields, bad ranges, and oversized bodies. Never loosen a bound
  to "make a client work" — fix the client.
- **Inserts stay idempotent.** Re-uploaded points/segments must not duplicate
  rows (the phone retries batches). Preserve the INSERT OR IGNORE / unique-key
  behavior in `db.js`.

## Housekeeping

- Secrets live in `.env` (never committed). The server refuses to start without
  `UPLOAD_TOKEN`.
- `geowise-ingest.db*` and `media/` are runtime data — never commit them.
- No build step; validate by starting the server and exercising the endpoints.

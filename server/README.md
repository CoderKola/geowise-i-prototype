# geowise ingest server

Tiny local server that receives GPS points from the geowise app and stores them
in SQLite. Exposed to the phone over a temporary **Cloudflare Quick Tunnel**.

## Security model
- **Auth:** every request needs `Authorization: Bearer <UPLOAD_TOKEN>`. No/wrong token → `401`.
- **Strict validation:** body must be exactly `{ points: [...] }`; unknown fields, out-of-range
  numbers, or batches > 500 → `400`. Body capped at 256 KB.
- **Write-only surface:** only `POST /points` (+ `GET /health`). There is **no read endpoint** —
  to view data, query the local `.db` on this laptop (see below).
- **Idempotent:** `UNIQUE(device_id, point_id)` means retried batches never duplicate.

## Run
```bash
cp .env.example .env          # then edit UPLOAD_TOKEN (openssl rand -hex 24)
npm install
npm start                     # http://localhost:3000
```

In another terminal, expose it (temporary public HTTPS URL):
```bash
brew install cloudflared      # once
cloudflared tunnel --url http://localhost:3000
```
Copy the printed `https://<random>.trycloudflare.com` URL into the app's **Sync** card,
enter the same token, toggle **Auto-upload**, then Start tracking.

> The tunnel URL is **ephemeral** — it changes each time you restart `cloudflared`,
> so re-paste it into the app when you start a new session.

## Inspect stored data
```bash
sqlite3 geowise-ingest.db 'select count(*) from points;'
sqlite3 geowise-ingest.db 'select device_id, session_id, point_id, lat, lon from points order by id desc limit 10;'
```

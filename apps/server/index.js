require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { EventEmitter } = require('events');
const { BatchSchema, MediaMetaSchema } = require('./schema');
const { insertPoints, insertMediaSegment, MEDIA_DIR } = require('./db');
const { startFeed } = require('./feed');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.UPLOAD_TOKEN;

// In-process bus: ingest (:3000) publishes accepted points, the dashboard
// feed (:3100) subscribes and streams them to the local browser.
const bus = new EventEmitter();
bus.setMaxListeners(0);

if (!TOKEN) {
  console.error(
    'FATAL: UPLOAD_TOKEN is not set. Copy .env.example to .env and set a long random token.'
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '256kb' }));

// Liveness only — no data, no auth. Everything else requires the shared secret.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Bearer auth: only requests carrying the shared secret may write.
app.use((req, res, next) => {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token !== TOKEN) {
    // Log enough to tell "no/garbled token" apart from "wrong token" without
    // echoing secrets to the console.
    console.warn(
      `[reject 401] ${req.method} ${req.path} token_present=${token !== null} ` +
        `token_len=${token ? token.length : 0}`
    );
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
});

app.post('/points', (req, res) => {
  const parsed = BatchSchema.safeParse(req.body);
  if (!parsed.success) {
    // Log the zod issues (paths + messages only, no values) so client/schema
    // mismatches are diagnosable from the server console.
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(' | ');
    console.warn(`[reject 400] /points n=${req.body?.points?.length ?? '?'} issues: ${issues}`);
    return res.status(400).json({ ok: false, error: 'invalid payload' });
  }
  const accepted = insertPoints(parsed.data.points);
  for (const p of parsed.data.points) {
    console.log(
      `[point] dev=${p.device_id} s=${p.session_id} #${p.point_id} ` +
        `${p.lat},${p.lon} acc=${p.accuracy} spd=${p.speed}`
    );
  }
  bus.emit('points', parsed.data.points); // -> live dashboard
  res.json({ ok: true, accepted });
});

// Video segment ingest: one ~15s MP4 chunk per request (multipart). Files land
// in MEDIA_DIR; metadata mirrors the app's media_segments queue. Idempotent —
// a retried upload of the same segment is ignored and its file discarded.
fs.mkdirSync(MEDIA_DIR, { recursive: true });
const mediaUpload = multer({
  dest: path.join(MEDIA_DIR, 'tmp'),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

app.post('/media', mediaUpload.single('file'), (req, res) => {
  const discardTmp = () => {
    if (req.file) fs.rmSync(req.file.path, { force: true });
  };

  const parsed = MediaMetaSchema.safeParse(req.body ?? {});
  if (!parsed.success || !req.file) {
    discardTmp();
    console.warn(`[reject 400] /media invalid ${!req.file ? '(no file)' : '(bad meta)'}`);
    return res.status(400).json({ ok: false, error: 'invalid media upload' });
  }

  const m = parsed.data;
  const safeDevice = (m.device_id ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${safeDevice}-s${m.session_id}-${m.facing}-${m.started_at}.mp4`;

  const { accepted, id } = insertMediaSegment({
    device_id: m.device_id,
    session_id: m.session_id,
    facing: m.facing,
    started_at: m.started_at,
    ended_at: m.ended_at,
    file_path: fileName,
    size_bytes: req.file.size,
  });

  if (accepted === 0) {
    discardTmp(); // duplicate re-send; the original file is already stored
    return res.json({ ok: true, accepted: 0 });
  }

  fs.renameSync(req.file.path, path.join(MEDIA_DIR, fileName));
  const segment = {
    id,
    device_id: m.device_id,
    session_id: m.session_id,
    facing: m.facing,
    started_at: m.started_at,
    ended_at: m.ended_at,
    size_bytes: req.file.size,
  };
  console.log(
    `[media] dev=${m.device_id} s=${m.session_id} ${m.facing} ` +
      `${new Date(m.started_at).toISOString()} ${(req.file.size / 1e6).toFixed(1)}MB`
  );
  bus.emit('media', segment); // -> live dashboard
  res.json({ ok: true, accepted });
});

// Body-parse / size errors -> tidy status without leaking internals.
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    console.warn('[reject 413] payload too large');
    return res.status(413).json({ ok: false, error: 'payload too large' });
  }
  console.warn(`[reject 400] body parse error: ${err?.type ?? err?.message ?? 'unknown'}`);
  return res.status(400).json({ ok: false, error: 'bad request' });
});

// Bind to loopback only: reachable by the local cloudflared process, but NOT
// by anything else on the LAN. The tunnel is the sole public entry (auth-gated).
app.listen(PORT, '127.0.0.1', () => {
  console.log(`geowise ingest server listening on http://127.0.0.1:${PORT}`);
  console.log(`Expose it:  cloudflared tunnel --url http://localhost:${PORT}`);
});

// Local-only dashboard feed (never tunneled).
startFeed(bus);

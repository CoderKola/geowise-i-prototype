require('dotenv').config();
const express = require('express');
const { BatchSchema } = require('./schema');
const { insertPoints } = require('./db');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.UPLOAD_TOKEN;

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
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
});

app.post('/points', (req, res) => {
  const parsed = BatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid payload' });
  }
  const accepted = insertPoints(parsed.data.points);
  for (const p of parsed.data.points) {
    console.log(
      `[point] dev=${p.device_id} s=${p.session_id} #${p.point_id} ` +
        `${p.lat},${p.lon} acc=${p.accuracy} spd=${p.speed}`
    );
  }
  res.json({ ok: true, accepted });
});

// Body-parse / size errors -> tidy status without leaking internals.
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'payload too large' });
  }
  return res.status(400).json({ ok: false, error: 'bad request' });
});

// Bind to loopback only: reachable by the local cloudflared process, but NOT
// by anything else on the LAN. The tunnel is the sole public entry (auth-gated).
app.listen(PORT, '127.0.0.1', () => {
  console.log(`geowise ingest server listening on http://127.0.0.1:${PORT}`);
  console.log(`Expose it:  cloudflared tunnel --url http://localhost:${PORT}`);
});

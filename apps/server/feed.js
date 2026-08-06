const express = require('express');
const { listSessions, sessionPoints } = require('./db');

// Dashboard feed — READ ONLY, bound to 127.0.0.1 ONLY, NEVER tunneled.
// This is the deliberate security split: the public tunnel exposes only the
// auth-gated ingest (:3000). Live GPS is served exclusively to the local browser.
const FEED_PORT = process.env.FEED_PORT || 3100;

// Permissive CORS for LOCAL dev origins only (the Vite dashboard on :5173).
function localCors(req, res, next) {
  const origin = req.get('origin') || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function startFeed(bus) {
  const app = express();
  app.use(localCors);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/sessions', (_req, res) => {
    res.json({ sessions: listSessions() });
  });

  app.get('/api/points', (req, res) => {
    const deviceId = req.query.device_id ?? null;
    const sessionId = req.query.session_id != null ? Number(req.query.session_id) : null;
    if (sessionId == null || Number.isNaN(sessionId)) {
      return res.status(400).json({ ok: false, error: 'session_id required' });
    }
    res.json({ points: sessionPoints(deviceId, sessionId) });
  });

  // Server-Sent Events: push each freshly-ingested batch to the browser live.
  app.get('/api/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const onPoints = (points) => {
      res.write(`data: ${JSON.stringify(points)}\n\n`);
    };
    bus.on('points', onPoints);

    const keepAlive = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      bus.off('points', onPoints);
    });
  });

  app.listen(FEED_PORT, '127.0.0.1', () => {
    console.log(`geowise dashboard feed on http://127.0.0.1:${FEED_PORT} (local only, not tunneled)`);
  });
}

module.exports = { startFeed };

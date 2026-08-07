const Database = require('better-sqlite3');
const path = require('path');

// Local SQLite store for ingested points. Mirrors the app's points schema
// plus server_received_at. UNIQUE(device_id, point_id) makes ingest
// idempotent — retried batches never duplicate.

const db = new Database(path.join(__dirname, 'geowise-ingest.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS points (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id          TEXT,
    session_id         INTEGER,
    point_id           INTEGER,
    timestamp          INTEGER,
    lat                REAL,
    lon                REAL,
    accuracy           REAL,
    altitude           REAL,
    speed              REAL,
    bearing            REAL,
    device_battery     REAL,
    altitude_accuracy  REAL,
    mocked             INTEGER,
    pressure           REAL,
    relative_altitude  REAL,
    battery_charging   INTEGER,
    network_type       TEXT,
    platform           TEXT,
    device_model       TEXT,
    device_type        TEXT,
    os_version         TEXT,
    server_received_at INTEGER NOT NULL,
    UNIQUE(device_id, point_id)
  );
`);

// Additive migration for DBs created before these columns existed (CREATE TABLE
// IF NOT EXISTS won't add them). Mirrors the app-side migration in database.ts.
const existing = new Set(db.prepare(`PRAGMA table_info(points)`).all().map((c) => c.name));
const addColumns = [
  ['altitude_accuracy', 'REAL'],
  ['mocked', 'INTEGER'],
  ['pressure', 'REAL'],
  ['relative_altitude', 'REAL'],
  ['battery_charging', 'INTEGER'],
  ['network_type', 'TEXT'],
  ['platform', 'TEXT'],
  ['device_model', 'TEXT'],
  ['device_type', 'TEXT'],
  ['os_version', 'TEXT'],
];
for (const [name, def] of addColumns) {
  if (!existing.has(name)) db.exec(`ALTER TABLE points ADD COLUMN ${name} ${def}`);
}

// One-time dedupe: before this guard existed, the mobile background task could
// re-deliver the same fix under new point_ids and each copy was ingested. Keep
// the earliest row per (device, session, fix time); the unique index + the
// INSERT OR IGNORE below make any still-queued duplicates no-ops on arrival.
db.exec(`
  DELETE FROM points WHERE id NOT IN (
    SELECT MIN(id) FROM points GROUP BY device_id, session_id, timestamp
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_points_unique_fix
    ON points(device_id, session_id, timestamp);
`);

// Video segments uploaded by the app (dashcam-style ~15s MP4 chunks). The
// actual files live in MEDIA_DIR; file_path stores just the file name.
// UNIQUE(...) makes retried uploads idempotent, mirroring the points table.
const MEDIA_DIR = path.join(__dirname, 'media');

db.exec(`
  CREATE TABLE IF NOT EXISTS media_segments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id          TEXT,
    session_id         INTEGER,
    facing             TEXT,
    started_at         INTEGER,
    ended_at           INTEGER,
    file_path          TEXT NOT NULL,
    size_bytes         INTEGER,
    server_received_at INTEGER NOT NULL,
    UNIQUE(device_id, session_id, facing, started_at)
  );
`);

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO points
    (device_id, session_id, point_id, timestamp, lat, lon, accuracy,
     altitude, speed, bearing, device_battery, altitude_accuracy, mocked,
     pressure, relative_altitude, battery_charging, network_type,
     platform, device_model, device_type, os_version, server_received_at)
  VALUES
    (@device_id, @session_id, @point_id, @timestamp, @lat, @lon, @accuracy,
     @altitude, @speed, @bearing, @device_battery, @altitude_accuracy, @mocked,
     @pressure, @relative_altitude, @battery_charging, @network_type,
     @platform, @device_model, @device_type, @os_version, @server_received_at)
`);

// Returns the number of NEW rows accepted (dupes are ignored, count 0).
function insertPoints(points) {
  const now = Date.now();
  const tx = db.transaction((rows) => {
    let accepted = 0;
    for (const p of rows) {
      accepted += insertStmt.run({ ...p, server_received_at: now }).changes;
    }
    return accepted;
  });
  return tx(points);
}

// --- read queries for the local dashboard feed (:3100) ---

const listSessionsStmt = db.prepare(`
  SELECT p.device_id, p.session_id,
         COUNT(*)         AS points,
         MIN(p.timestamp) AS started_at,
         MAX(p.timestamp) AS ended_at,
         (SELECT COUNT(*) FROM media_segments m
           WHERE m.device_id IS p.device_id AND m.session_id IS p.session_id) AS media_segments
  FROM points p
  GROUP BY p.device_id, p.session_id
  ORDER BY ended_at DESC
`);
function listSessions() {
  return listSessionsStmt.all();
}

const sessionPointsStmt = db.prepare(`
  SELECT point_id, timestamp, lat, lon, accuracy, altitude, speed, bearing,
         device_battery, battery_charging, network_type, platform
  FROM points
  WHERE device_id IS ? AND session_id IS ?
  ORDER BY timestamp
`);
function sessionPoints(deviceId, sessionId) {
  return sessionPointsStmt.all(deviceId, sessionId);
}

// --- media segments ---

const insertMediaStmt = db.prepare(`
  INSERT OR IGNORE INTO media_segments
    (device_id, session_id, facing, started_at, ended_at, file_path,
     size_bytes, server_received_at)
  VALUES
    (@device_id, @session_id, @facing, @started_at, @ended_at, @file_path,
     @size_bytes, @server_received_at)
`);
// Returns { accepted, id } — id is null when the segment was a duplicate.
function insertMediaSegment(seg) {
  const info = insertMediaStmt.run({ ...seg, server_received_at: Date.now() });
  return {
    accepted: info.changes,
    id: info.changes > 0 ? Number(info.lastInsertRowid) : null,
  };
}

const sessionMediaStmt = db.prepare(`
  SELECT id, device_id, session_id, facing, started_at, ended_at, size_bytes
  FROM media_segments
  WHERE device_id IS ? AND session_id IS ?
  ORDER BY started_at
`);
function sessionMedia(deviceId, sessionId) {
  return sessionMediaStmt.all(deviceId, sessionId);
}

const mediaByIdStmt = db.prepare(`SELECT * FROM media_segments WHERE id = ?`);
function mediaSegmentById(id) {
  return mediaByIdStmt.get(id);
}

module.exports = {
  db,
  insertPoints,
  listSessions,
  sessionPoints,
  MEDIA_DIR,
  insertMediaSegment,
  sessionMedia,
  mediaSegmentById,
};

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
];
for (const [name, def] of addColumns) {
  if (!existing.has(name)) db.exec(`ALTER TABLE points ADD COLUMN ${name} ${def}`);
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO points
    (device_id, session_id, point_id, timestamp, lat, lon, accuracy,
     altitude, speed, bearing, device_battery, altitude_accuracy, mocked,
     pressure, relative_altitude, battery_charging, network_type, server_received_at)
  VALUES
    (@device_id, @session_id, @point_id, @timestamp, @lat, @lon, @accuracy,
     @altitude, @speed, @bearing, @device_battery, @altitude_accuracy, @mocked,
     @pressure, @relative_altitude, @battery_charging, @network_type, @server_received_at)
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
  SELECT device_id, session_id,
         COUNT(*)       AS points,
         MIN(timestamp) AS started_at,
         MAX(timestamp) AS ended_at
  FROM points
  GROUP BY device_id, session_id
  ORDER BY ended_at DESC
`);
function listSessions() {
  return listSessionsStmt.all();
}

const sessionPointsStmt = db.prepare(`
  SELECT point_id, timestamp, lat, lon, accuracy, altitude, speed, bearing,
         device_battery, battery_charging, network_type
  FROM points
  WHERE device_id IS ? AND session_id IS ?
  ORDER BY timestamp
`);
function sessionPoints(deviceId, sessionId) {
  return sessionPointsStmt.all(deviceId, sessionId);
}

module.exports = { db, insertPoints, listSessions, sessionPoints };

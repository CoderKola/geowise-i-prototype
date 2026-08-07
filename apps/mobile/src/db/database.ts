import * as SQLite from 'expo-sqlite';

// Single lazily-opened connection. SQLite is the source of truth (durable,
// transactional); CSV is an on-demand export derived from it.

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = openAndInit();
  return dbPromise;
}

async function openAndInit(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('geowise.db');
  // sessions (parent) -> points (child). Session = one Start->Stop trip.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id  TEXT,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      label      TEXT
    );

    CREATE TABLE IF NOT EXISTS points (
      point_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions(session_id),
      device_id         TEXT,
      timestamp         INTEGER NOT NULL,
      lat               REAL,
      lon               REAL,
      accuracy          REAL,
      altitude          REAL,
      speed             REAL,
      bearing           REAL,
      device_battery    REAL,
      altitude_accuracy REAL,
      mocked            INTEGER,
      pressure          REAL,
      relative_altitude REAL,
      battery_charging  INTEGER,
      network_type      TEXT,
      platform          TEXT,
      device_model      TEXT,
      device_type       TEXT,
      os_version        TEXT,
      uploaded          INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_points_session  ON points(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_points_uploaded ON points(uploaded);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS media_segments (
      segment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      device_id  TEXT,
      facing     TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER NOT NULL,
      file_uri   TEXT NOT NULL,
      size_bytes INTEGER,
      uploaded   INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_unique
      ON media_segments(session_id, facing, started_at);
    CREATE INDEX IF NOT EXISTS idx_media_uploaded ON media_segments(uploaded);
  `);

  // Additive migration for installs predating newer columns. Each ALTER is a
  // no-op-guarded add so upgrading an existing DB never loses data.
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(points)`);
  const have = new Set(cols.map((c) => c.name));
  const addColumns: [string, string][] = [
    ['uploaded', 'INTEGER NOT NULL DEFAULT 0'],
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
    if (!have.has(name)) {
      await db.execAsync(`ALTER TABLE points ADD COLUMN ${name} ${def}`);
    }
  }

  // Dedupe guard: the OS can re-deliver location batches to the background
  // task, which used to record the same fix under new point_ids. Purge
  // existing duplicates (preferring rows already marked uploaded, so they
  // aren't re-sent), then enforce uniqueness — paired with INSERT OR IGNORE
  // in insertPoint, redelivered fixes become no-ops.
  await db.execAsync(`
    DELETE FROM points WHERE point_id NOT IN (
      SELECT point_id FROM (
        SELECT point_id,
               ROW_NUMBER() OVER (
                 PARTITION BY session_id, timestamp
                 ORDER BY uploaded DESC, point_id ASC
               ) AS rn
        FROM points
      ) WHERE rn = 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_points_unique_fix
      ON points(session_id, timestamp);
  `);

  return db;
}

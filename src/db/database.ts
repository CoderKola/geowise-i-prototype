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
      uploaded          INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_points_session  ON points(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_points_uploaded ON points(uploaded);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
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
  ];
  for (const [name, def] of addColumns) {
    if (!have.has(name)) {
      await db.execAsync(`ALTER TABLE points ADD COLUMN ${name} ${def}`);
    }
  }

  return db;
}

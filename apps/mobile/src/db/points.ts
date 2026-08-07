import { getDb } from './database';
import type { Point } from '../types';

export type NewPoint = Omit<Point, 'point_id'>;

// Returns true if a row was actually inserted (false = duplicate ignored).
export async function insertPoint(p: NewPoint): Promise<boolean> {
  const db = await getDb();
  // OR IGNORE + the unique (session_id, timestamp) index: a re-delivered
  // location batch silently no-ops instead of duplicating fixes.
  const res = await db.runAsync(
    `INSERT OR IGNORE INTO points
       (session_id, device_id, timestamp, lat, lon, accuracy, altitude, speed, bearing,
        device_battery, altitude_accuracy, mocked, pressure, relative_altitude,
        battery_charging, network_type, platform, device_model, device_type, os_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.session_id,
    p.device_id,
    p.timestamp,
    p.lat,
    p.lon,
    p.accuracy,
    p.altitude,
    p.speed,
    p.bearing,
    p.device_battery,
    p.altitude_accuracy,
    p.mocked,
    p.pressure,
    p.relative_altitude,
    p.battery_charging,
    p.network_type,
    p.platform,
    p.device_model,
    p.device_type,
    p.os_version
  );
  return res.changes > 0;
}

export async function getPointsForSession(sessionId: number): Promise<Point[]> {
  const db = await getDb();
  return db.getAllAsync<Point>(
    'SELECT * FROM points WHERE session_id = ? ORDER BY timestamp',
    sessionId
  );
}

export async function countPointsForSession(sessionId: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM points WHERE session_id = ?',
    sessionId
  );
  return row?.n ?? 0;
}

// --- upload queue helpers (Phase-3 sync) ---

export async function getUnuploadedPoints(limit: number): Promise<Point[]> {
  const db = await getDb();
  return db.getAllAsync<Point>(
    'SELECT * FROM points WHERE uploaded = 0 ORDER BY timestamp LIMIT ?',
    limit
  );
}

export async function markUploaded(pointIds: number[]): Promise<void> {
  if (pointIds.length === 0) return;
  const db = await getDb();
  const placeholders = pointIds.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE points SET uploaded = 1 WHERE point_id IN (${placeholders})`,
    ...pointIds
  );
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM points WHERE uploaded = 0'
  );
  return row?.n ?? 0;
}

export async function countUploaded(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM points WHERE uploaded = 1'
  );
  return row?.n ?? 0;
}

// Free up phone storage: remove only points that are safely on the server,
// then drop ended sessions left with no points. Un-synced data is never touched.
export async function deleteUploadedPoints(): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync('DELETE FROM points WHERE uploaded = 1');
  await db.runAsync(
    `DELETE FROM sessions
     WHERE ended_at IS NOT NULL
       AND session_id NOT IN (SELECT DISTINCT session_id FROM points)`
  );
  return res.changes;
}

export async function deleteSessionData(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM points WHERE session_id = ?', sessionId);
  await db.runAsync('DELETE FROM sessions WHERE session_id = ?', sessionId);
}

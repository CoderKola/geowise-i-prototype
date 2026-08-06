import { getDb } from './database';
import type { Session } from '../types';

export async function startSession(
  deviceId: string | null,
  label: string | null
): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO sessions (device_id, started_at, ended_at, label) VALUES (?, ?, NULL, ?)',
    deviceId,
    Date.now(),
    label
  );
  return res.lastInsertRowId;
}

export async function endSession(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE sessions SET ended_at = ? WHERE session_id = ?',
    Date.now(),
    sessionId
  );
}

export async function listSessions(): Promise<Session[]> {
  const db = await getDb();
  return db.getAllAsync<Session>('SELECT * FROM sessions ORDER BY started_at DESC');
}

export async function getSession(sessionId: number): Promise<Session | null> {
  const db = await getDb();
  return db.getFirstAsync<Session>(
    'SELECT * FROM sessions WHERE session_id = ?',
    sessionId
  );
}

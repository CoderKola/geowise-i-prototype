import { getDb } from './database';
import type { Session } from '../types';

export async function startSession(
  deviceId: string | null,
  label: string | null
): Promise<number> {
  const db = await getDb();
  // Reinstall-proof session identity: epoch SECONDS at Start, not the table's
  // AUTOINCREMENT counter. A reinstall wipes this DB and restarts counters at
  // 1, which used to collide with the same device's earlier sessions on the
  // server (new rides merged into old ones and their points were dropped as
  // "duplicates"). Epoch ids can never collide across installs; bump by one
  // in the (unlikely) case two sessions start within the same second.
  let sessionId = Math.floor(Date.now() / 1000);
  for (;;) {
    const existing = await db.getFirstAsync<{ session_id: number }>(
      'SELECT session_id FROM sessions WHERE session_id = ?',
      sessionId
    );
    if (existing == null) break;
    sessionId += 1;
  }
  await db.runAsync(
    'INSERT INTO sessions (session_id, device_id, started_at, ended_at, label) VALUES (?, ?, ?, NULL, ?)',
    sessionId,
    deviceId,
    Date.now(),
    label
  );
  return sessionId;
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

import { getDb } from './database';

// Key/value settings persisted in the SQLite `meta` table (no extra dep).
// Holds the upload target so the user doesn't retype it every launch.

async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}

export interface UploadSettings {
  serverUrl: string;
  uploadToken: string;
  uploadEnabled: boolean;
}

export async function getUploadSettings(): Promise<UploadSettings> {
  const [serverUrl, uploadToken, enabled] = await Promise.all([
    getSetting('server_url'),
    getSetting('upload_token'),
    getSetting('upload_enabled'),
  ]);
  return {
    serverUrl: serverUrl ?? '',
    uploadToken: uploadToken ?? '',
    uploadEnabled: enabled === '1',
  };
}

export async function saveUploadSettings(s: UploadSettings): Promise<void> {
  await setSetting('server_url', s.serverUrl.trim());
  await setSetting('upload_token', s.uploadToken.trim());
  await setSetting('upload_enabled', s.uploadEnabled ? '1' : '0');
}

// --- active recording session ---
// Persisted so the background location task (which may run after the app was
// killed and relaunched headlessly) knows which session to append points to.

export interface ActiveSession {
  sessionId: number;
  deviceId: string | null;
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  const [sid, deviceId] = await Promise.all([
    getSetting('active_session_id'),
    getSetting('active_device_id'),
  ]);
  if (sid == null) return null;
  const sessionId = Number(sid);
  if (!Number.isFinite(sessionId)) return null;
  return { sessionId, deviceId: deviceId || null };
}

export async function setActiveSession(sessionId: number, deviceId: string | null): Promise<void> {
  await setSetting('active_session_id', String(sessionId));
  await setSetting('active_device_id', deviceId ?? '');
}

export async function clearActiveSession(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM meta WHERE key IN ('active_session_id', 'active_device_id')"
  );
}

import { File } from 'expo-file-system';
import { getDb } from './database';

// Retention pass for synced video chunks (plan item 7): delete local segment
// files ONLY for rows that are both confirmed on the server (uploaded = 1 —
// set exclusively on a server 200 with idempotent inserts) and older than the
// retention window, then prune those rows. The `uploaded = 1` SQL filter is
// the safety invariant: pending rows and their files are untouchable by
// construction. Runs on app start and on the foreground sync tick — a cheap
// no-op when nothing qualifies.

const RETENTION_MS = 24 * 60 * 60 * 1000; // 24h after confirmed upload

export async function cleanupUploadedSegments(): Promise<number> {
  const cutoff = Date.now() - RETENTION_MS;
  const db = await getDb();
  const rows = await db.getAllAsync<{ segment_id: number; file_uri: string }>(
    'SELECT segment_id, file_uri FROM media_segments WHERE uploaded = 1 AND ended_at < ?',
    cutoff
  );
  if (rows.length === 0) return 0;

  for (const row of rows) {
    try {
      const file = new File(row.file_uri);
      if (file.exists) file.delete();
    } catch {
      // file already gone or unreadable — row cleanup proceeds regardless
    }
  }
  const res = await db.runAsync(
    'DELETE FROM media_segments WHERE uploaded = 1 AND ended_at < ?',
    cutoff
  );
  return res.changes;
}

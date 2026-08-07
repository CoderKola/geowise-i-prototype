import { File } from 'expo-file-system';
import { getDb } from './database';

// Video segment queue — mirrors the points queue pattern: rows are written by
// the segment recorder, drained oldest-first by the uploader, and marked
// uploaded only on a server 200.

export interface MediaSegment {
  segment_id: number;
  session_id: number;
  device_id: string | null;
  facing: string;
  started_at: number;
  ended_at: number;
  file_uri: string;
  size_bytes: number | null;
  uploaded: number;
}

export type NewMediaSegment = Omit<MediaSegment, 'segment_id' | 'uploaded'>;

export async function insertSegment(s: NewMediaSegment): Promise<void> {
  const db = await getDb();
  // OR IGNORE + unique (session_id, facing, started_at): retried writes no-op.
  await db.runAsync(
    `INSERT OR IGNORE INTO media_segments
       (session_id, device_id, facing, started_at, ended_at, file_uri, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    s.session_id,
    s.device_id,
    s.facing,
    s.started_at,
    s.ended_at,
    s.file_uri,
    s.size_bytes
  );
}

export async function getUnuploadedSegments(limit: number): Promise<MediaSegment[]> {
  const db = await getDb();
  return db.getAllAsync<MediaSegment>(
    'SELECT * FROM media_segments WHERE uploaded = 0 ORDER BY started_at LIMIT ?',
    limit
  );
}

export async function markSegmentUploaded(segmentId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE media_segments SET uploaded = 1 WHERE segment_id = ?', segmentId);
}

export async function countPendingSegments(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM media_segments WHERE uploaded = 0'
  );
  return row?.n ?? 0;
}

export async function countUploadedSegments(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM media_segments WHERE uploaded = 1'
  );
  return row?.n ?? 0;
}

// Free up phone storage: remove segment files + rows that are safely on the
// server. Un-synced segments are never touched.
export async function deleteUploadedSegments(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ segment_id: number; file_uri: string }>(
    'SELECT segment_id, file_uri FROM media_segments WHERE uploaded = 1'
  );
  for (const row of rows) {
    try {
      const f = new File(row.file_uri);
      if (f.exists) f.delete();
    } catch {
      // file already gone — still drop the row
    }
  }
  const res = await db.runAsync('DELETE FROM media_segments WHERE uploaded = 1');
  return res.changes;
}

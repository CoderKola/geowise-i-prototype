import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getSession } from '../db/sessions';
import { getPointsForSession } from '../db/points';
import type { Point } from '../types';

// One CSV per session -> "folders-of-trips" model. Generated on demand from
// SQLite, written to the document dir, handed to the native share sheet.

const COLUMNS: (keyof Point)[] = [
  'point_id',
  'session_id',
  'device_id',
  'timestamp',
  'lat',
  'lon',
  'accuracy',
  'altitude',
  'speed',
  'bearing',
  'device_battery',
  'altitude_accuracy',
  'mocked',
  'pressure',
  'relative_altitude',
  'battery_charging',
  'network_type',
];

function toCsv(points: Point[]): string {
  const header = COLUMNS.join(',');
  const rows = points.map((p) =>
    COLUMNS.map((c) => {
      const v = p[c];
      return v === null || v === undefined ? '' : String(v);
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

function filenameFor(label: string | null, sessionId: number): string {
  if (label) {
    const base = label.replace(/[^a-z0-9-_]+/gi, '-');
    return `session-${base}-${sessionId}.csv`;
  }
  return `session-${sessionId}.csv`;
}

export async function exportSessionCsv(sessionId: number): Promise<void> {
  const session = await getSession(sessionId);
  const points = await getPointsForSession(sessionId);
  const csv = toCsv(points);

  const file = new File(Paths.document, filenameFor(session?.label ?? null, sessionId));
  try {
    if (file.exists) file.delete();
  } catch {
    // fresh file; nothing to delete
  }
  file.create();
  file.write(csv);

  if (await Sharing.isAvailableAsync()) {
    // TODO(android): Android's FileProvider needs file.contentUri (content://),
    // not file.uri (file://). iPhone-first, so file.uri is correct for now.
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export session CSV',
      UTI: 'public.comma-separated-values-text',
    });
  }
}

import { File } from 'expo-file-system';
import { getUnuploadedPoints, markUploaded } from '../db/points';
import {
  getUnuploadedSegments,
  markSegmentUploaded,
  type MediaSegment,
} from '../db/media';
import type { Point } from '../types';

// Reads a batch of un-uploaded points and POSTs them to the laptop server.
// Offline-safe: only marks rows uploaded on a 200, so failures just retry.

const BATCH = 200;
// Video segments per drain pass — they're ~5-15 MB each, so keep the count low
// enough that a pass finishes promptly; the next tick picks up the rest.
const MEDIA_BATCH = 4;

// The user enters just the Quick Tunnel slug (e.g. "accessing-pulled-cio-influences");
// we expand it to the full https URL. Full URLs / bare domains still work if pasted.
export function normalizeServerUrl(input: string): string {
  const v = input.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes('.')) return `https://${v}`;
  return `https://${v}.trycloudflare.com`;
}

export interface SyncResult {
  sent: number;
  /** video segments uploaded in this pass */
  sentMedia: number;
  status: number | null;
  error: string | null;
}

// Send ONLY the defined fields — never the local `uploaded` flag (the server
// schema is strict and rejects unknown fields).
function toWire(p: Point) {
  return {
    device_id: p.device_id,
    session_id: p.session_id,
    point_id: p.point_id,
    timestamp: p.timestamp,
    lat: p.lat,
    lon: p.lon,
    accuracy: p.accuracy,
    altitude: p.altitude,
    speed: p.speed,
    bearing: p.bearing,
    device_battery: p.device_battery,
    altitude_accuracy: p.altitude_accuracy,
    mocked: p.mocked,
    pressure: p.pressure,
    relative_altitude: p.relative_altitude,
    battery_charging: p.battery_charging,
    network_type: p.network_type,
    platform: p.platform,
    device_model: p.device_model,
    device_type: p.device_type,
    os_version: p.os_version,
  };
}

// Global in-flight guard: the foreground interval, the background location
// task, and the OS background flush can all trigger a sync — never let two
// drains interleave (double-sends waste the batch budget).
let draining = false;

// Sends batches back-to-back until the queue is empty, an error occurs, or
// maxBatches is hit, then uploads pending video segments. Points always drain
// first — telemetry wins over video. Returns the TOTAL sent across batches.
export async function drainQueue(
  url: string,
  rawToken: string,
  maxBatches = 50
): Promise<SyncResult> {
  if (draining) return { sent: 0, sentMedia: 0, status: null, error: null };
  draining = true;
  try {
    let total = 0;
    let last: SyncResult = { sent: 0, sentMedia: 0, status: null, error: null };
    for (let i = 0; i < maxBatches; i++) {
      last = await syncOnce(url, rawToken);
      total += last.sent;
      if (last.error || last.sent < BATCH) break; // drained or failed
    }
    let sentMedia = 0;
    if (last.error == null) {
      sentMedia = await syncMediaOnce(url, rawToken);
    }
    return { sent: total, sentMedia, status: last.status, error: last.error };
  } finally {
    draining = false;
  }
}

export async function syncOnce(url: string, rawToken: string): Promise<SyncResult> {
  const base = normalizeServerUrl(url);
  const token = rawToken.trim(); // stray whitespace from mobile keyboards -> 401
  if (!base || !token) {
    return { sent: 0, sentMedia: 0, status: null, error: 'missing url or token' };
  }

  const points = await getUnuploadedPoints(BATCH);
  if (points.length === 0) return { sent: 0, sentMedia: 0, status: null, error: null };

  try {
    const res = await fetch(`${base}/points`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ points: points.map(toWire) }),
    });
    if (res.status !== 200) {
      return { sent: 0, sentMedia: 0, status: res.status, error: `server returned ${res.status}` };
    }
    // Ignore the response body beyond the status — never trust arbitrary data.
    await markUploaded(points.map((p) => p.point_id));
    return { sent: points.length, sentMedia: 0, status: 200, error: null };
  } catch (e: any) {
    return { sent: 0, sentMedia: 0, status: null, error: String(e?.message ?? e) };
  }
}

// --- video segment upload (multipart) ---

async function uploadSegment(base: string, token: string, seg: MediaSegment): Promise<boolean> {
  // If the local file vanished (cleared storage, crash mid-write), there is
  // nothing to send — mark it done so it can't poison the queue forever.
  try {
    if (!new File(seg.file_uri).exists) {
      await markSegmentUploaded(seg.segment_id);
      return true;
    }
  } catch {
    // exists-check failed; attempt the upload anyway
  }

  const form = new FormData();
  form.append('device_id', seg.device_id ?? '');
  form.append('session_id', String(seg.session_id));
  form.append('facing', seg.facing);
  form.append('started_at', String(seg.started_at));
  form.append('ended_at', String(seg.ended_at));
  // React Native FormData file part: { uri, name, type }
  form.append('file', {
    uri: seg.file_uri,
    name: `s${seg.session_id}-${seg.facing}-${seg.started_at}.mp4`,
    type: 'video/mp4',
  } as unknown as Blob);

  const res = await fetch(`${base}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (res.status !== 200) return false;
  await markSegmentUploaded(seg.segment_id);
  return true;
}

// Uploads up to MEDIA_BATCH pending video segments, oldest first.
// Returns how many were uploaded; stops early on the first failure.
async function syncMediaOnce(url: string, rawToken: string): Promise<number> {
  const base = normalizeServerUrl(url);
  const token = rawToken.trim();
  if (!base || !token) return 0;

  const segments = await getUnuploadedSegments(MEDIA_BATCH);
  let sent = 0;
  for (const seg of segments) {
    try {
      if (!(await uploadSegment(base, token, seg))) break;
      sent += 1;
    } catch {
      break; // offline or server down — retry next drain
    }
  }
  return sent;
}

import { getUnuploadedPoints, markUploaded } from '../db/points';
import type { Point } from '../types';

// Reads a batch of un-uploaded points and POSTs them to the laptop server.
// Offline-safe: only marks rows uploaded on a 200, so failures just retry.

const BATCH = 200;

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
  };
}

export async function syncOnce(url: string, rawToken: string): Promise<SyncResult> {
  const base = normalizeServerUrl(url);
  const token = rawToken.trim(); // stray whitespace from mobile keyboards -> 401
  if (!base || !token) {
    return { sent: 0, status: null, error: 'missing url or token' };
  }

  const points = await getUnuploadedPoints(BATCH);
  if (points.length === 0) return { sent: 0, status: null, error: null };

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
      return { sent: 0, status: res.status, error: `server returned ${res.status}` };
    }
    // Ignore the response body beyond the status — never trust arbitrary data.
    await markUploaded(points.map((p) => p.point_id));
    return { sent: points.length, status: 200, error: null };
  } catch (e: any) {
    return { sent: 0, status: null, error: String(e?.message ?? e) };
  }
}

// Shared row types — mirror the SQLite schema in src/db/database.ts.
// Column set is shaped as a GPS telemetry record so the data is already
// ready for HTTP upload (Phase 2/3).

export interface Session {
  session_id: number;
  device_id: string | null;
  started_at: number; // epoch ms
  ended_at: number | null; // epoch ms, null while active
  label: string | null;
}

export interface Point {
  point_id: number;
  session_id: number;
  device_id: string | null;
  timestamp: number; // epoch ms (from the OS location fix)
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null; // m/s, jitter-clamped
  bearing: number | null; // degrees (coords.heading)
  device_battery: number | null; // 0..1, null if unavailable
  altitude_accuracy: number | null; // meters, vertical accuracy
  mocked: number | null; // 1 if OS-reported mock location (Android), null on iOS
  pressure: number | null; // hPa, barometer (null if no sensor)
  relative_altitude: number | null; // meters, barometer relative altitude (iOS)
  battery_charging: number | null; // 1 charging, 0 not, null unknown
  network_type: string | null; // 'wifi' | 'cellular' | ... lowercased, null if unknown
  platform: string | null; // 'iOS' | 'Android' | ...
  device_model: string | null; // e.g. 'Pixel 7', 'iPhone 12'
  device_type: string | null; // 'phone' | 'tablet' | 'desktop' | 'tv' | 'unknown'
  os_version: string | null; // OS version string
  uploaded?: number; // 0 = pending, 1 = sent to laptop server
}

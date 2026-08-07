import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import type { LocationObject } from 'expo-location';
import { insertPoint } from '../db/points';
import { getDeviceMeta } from '../device';

// Shared point-building/writing logic used by BOTH capture paths:
// the foreground watcher (Expo Go fallback) and the background location task.
// Keeping it in one place means the two paths can never drift apart.

// Below this m/s, GPS jitter reads as movement while standing still — clamp to 0.
export const SPEED_CLAMP = 0.5;

// Latest barometer reading. Updated by TrackingContext's listener while the app
// is alive; there is no background barometer API, so backgrounded points carry
// the last foreground reading (or null).
export const latestBaro: { pressure: number | null; relativeAltitude: number | null } = {
  pressure: null,
  relativeAltitude: null,
};

// Live snapshot handed to UI subscribers after each successful write.
export interface WrittenPoint {
  lat: number;
  lon: number;
  speed: number; // m/s, jitter-clamped
  bearing: number | null;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  battery: number | null;
  charging: number | null;
}

type WriteListener = (p: WrittenPoint) => void;
const listeners = new Set<WriteListener>();

// UI (TrackingContext) subscribes to update live state regardless of which
// capture path produced the point.
export function subscribeWrites(cb: WriteListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function writeLocation(
  sessionId: number,
  deviceId: string | null,
  loc: LocationObject
): Promise<void> {
  const c = loc.coords;
  const rawSpeed = c.speed ?? 0;
  const speed = rawSpeed < SPEED_CLAMP ? 0 : rawSpeed;

  // Best-effort sensor snapshot — a failure of any never drops the point.
  let battery: number | null = null;
  let charging: number | null = null;
  try {
    const lvl = await Battery.getBatteryLevelAsync();
    battery = lvl >= 0 ? lvl : null; // -1 when unavailable (e.g. simulator)
    const st = await Battery.getBatteryStateAsync();
    charging =
      st === Battery.BatteryState.CHARGING || st === Battery.BatteryState.FULL
        ? 1
        : st === Battery.BatteryState.UNPLUGGED
          ? 0
          : null;
  } catch {
    /* keep nulls */
  }

  let networkType: string | null = null;
  try {
    const ns = await Network.getNetworkStateAsync();
    networkType = ns.type ? String(ns.type).toLowerCase() : null;
  } catch {
    /* keep null */
  }

  const meta = getDeviceMeta();

  const inserted = await insertPoint({
    session_id: sessionId,
    device_id: deviceId,
    timestamp: loc.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude,
    speed,
    bearing: c.heading,
    device_battery: battery,
    altitude_accuracy: c.altitudeAccuracy ?? null,
    mocked: (loc as any).mocked === true ? 1 : null,
    pressure: latestBaro.pressure,
    relative_altitude: latestBaro.relativeAltitude,
    battery_charging: charging,
    network_type: networkType,
    platform: meta.platform,
    device_model: meta.device_model,
    device_type: meta.device_type,
    os_version: meta.os_version,
  });
  if (!inserted) return; // duplicate fix (re-delivered batch) — don't notify UI

  const written: WrittenPoint = {
    lat: c.latitude,
    lon: c.longitude,
    speed,
    bearing: c.heading,
    accuracy: c.accuracy,
    altitude: c.altitude,
    altitudeAccuracy: c.altitudeAccuracy ?? null,
    battery,
    charging,
  };
  listeners.forEach((cb) => cb(written));
}

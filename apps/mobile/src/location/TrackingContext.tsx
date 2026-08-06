import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import { Barometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { getDeviceId } from '../device';
import { startSession, endSession } from '../db/sessions';
import { insertPoint } from '../db/points';
import { getDb } from '../db/database';

// Below this m/s, GPS jitter reads as movement while standing still — clamp to 0.
const SPEED_CLAMP = 0.5;

// Keep-awake tag: screen must not auto-lock mid-recording (foreground-only app;
// lock = recording stops). Essential for driving sessions with a mounted phone.
const KEEP_AWAKE_TAG = 'geowise-tracking';

export interface LiveState {
  isTracking: boolean;
  sessionId: number | null;
  lat: number | null;
  lon: number | null;
  speedMph: number | null;
  bearing: number | null; // degrees heading
  accuracy: number | null;
  altitude: number | null; // meters (stored SI; displayed in ft)
  altitudeAccuracy: number | null; // meters
  batteryPct: number | null; // 0..1
  batteryCharging: number | null; // 1/0/null
  pointCount: number;
  lastWriteAt: number | null;
  error: string | null;
  lastSessionId: number | null; // last finished session, for export after Stop
}

interface TrackingContextValue extends LiveState {
  ready: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const initialState: LiveState = {
  isTracking: false,
  sessionId: null,
  lat: null,
  lon: null,
  speedMph: null,
  bearing: null,
  accuracy: null,
  altitude: null,
  altitudeAccuracy: null,
  batteryPct: null,
  batteryCharging: null,
  pointCount: 0,
  lastWriteAt: null,
  error: null,
  lastSessionId: null,
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const baroSubRef = useRef<{ remove: () => void } | null>(null);
  const baroRef = useRef<{ pressure: number | null; relativeAltitude: number | null }>({
    pressure: null,
    relativeAltitude: null,
  });
  const sessionIdRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const countRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<LiveState>(initialState);

  useEffect(() => {
    (async () => {
      await getDb(); // create schema before any Start
      deviceIdRef.current = await getDeviceId();
      setReady(true);
    })();
    return () => {
      subRef.current?.remove();
      subRef.current = null;
      baroSubRef.current?.remove();
      baroSubRef.current = null;
      deactivateKeepAwake(KEEP_AWAKE_TAG); // never leave the screen pinned awake
    };
  }, []);

  const start = useCallback(async () => {
    if (subRef.current) return; // already tracking

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setState((s) => ({ ...s, error: 'Location permission denied' }));
      return;
    }

    const deviceId = deviceIdRef.current;
    const sessionId = await startSession(deviceId, null);
    sessionIdRef.current = sessionId;
    countRef.current = 0;
    setState((s) => ({
      ...initialState,
      isTracking: true,
      sessionId,
      lastSessionId: s.lastSessionId,
    }));

    // Keep the screen on while recording — foreground-only app, lock = stop.
    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } catch {
      // non-fatal; tracking proceeds without it
    }

    // Barometer (if present): keep the latest reading in a ref, snapshot per point.
    baroRef.current = { pressure: null, relativeAltitude: null };
    try {
      if (await Barometer.isAvailableAsync()) {
        baroSubRef.current = Barometer.addListener((d) => {
          baroRef.current = {
            pressure: typeof d.pressure === 'number' ? d.pressure : null,
            relativeAltitude:
              typeof (d as any).relativeAltitude === 'number'
                ? (d as any).relativeAltitude
                : null,
          };
        });
      }
    } catch {
      // no barometer; pressure stays null
    }

    subRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 10, // metres — distance-based sampling
        timeInterval: 0, // Android-only; 0 = no minimum wait
      },
      async (loc) => {
        const sid = sessionIdRef.current;
        if (sid == null) return;

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

        const baro = baroRef.current;

        await insertPoint({
          session_id: sid,
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
          pressure: baro.pressure,
          relative_altitude: baro.relativeAltitude,
          battery_charging: charging,
          network_type: networkType,
        });

        countRef.current += 1;
        setState((s) => ({
          ...s,
          lat: c.latitude,
          lon: c.longitude,
          speedMph: speed * 2.23694,
          bearing: c.heading,
          accuracy: c.accuracy,
          altitude: c.altitude,
          altitudeAccuracy: c.altitudeAccuracy ?? null,
          batteryPct: battery,
          batteryCharging: charging,
          pointCount: countRef.current,
          lastWriteAt: Date.now(),
        }));
      }
    );
  }, []);

  const stop = useCallback(async () => {
    subRef.current?.remove();
    subRef.current = null;
    baroSubRef.current?.remove();
    baroSubRef.current = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid != null) await endSession(sid);
    setState((s) => ({
      ...s,
      isTracking: false,
      sessionId: null,
      lastSessionId: sid ?? s.lastSessionId,
    }));
  }, []);

  return (
    <TrackingContext.Provider value={{ ...state, ready, start, stop }}>
      {children}
    </TrackingContext.Provider>
  );
}

export function useTracking(): TrackingContextValue {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}

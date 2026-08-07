import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as Location from 'expo-location';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Barometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { getDeviceId } from '../device';
import { startSession, endSession } from '../db/sessions';
import { countPointsForSession } from '../db/points';
import { getDb } from '../db/database';
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
} from '../db/settings';
import { latestBaro, subscribeWrites, writeLocation, type WrittenPoint } from './pointWriter';
import { LOCATION_TASK } from './backgroundTask';
import { startCapture, stopCapture } from '../camera/camera';
import type { CameraMode } from '../camera/types';

// Expo Go can't run background location (custom builds only) — fall back to
// the foreground watcher + keep-awake there so the pinned iPhone still works.
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Keep-awake tag: in foreground-only mode the screen must not auto-lock
// mid-recording (lock = recording stops). Not needed in background mode.
const KEEP_AWAKE_TAG = 'geowise-tracking';

export interface LiveState {
  isTracking: boolean;
  backgroundActive: boolean; // true = OS-level background recording is on
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
  videoMode: CameraMode | null; // 'dual' | 'single' while video capture runs
  videoNotice: string | null; // capability/fallback message for the UI
}

interface TrackingContextValue extends LiveState {
  ready: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const initialState: LiveState = {
  isTracking: false,
  backgroundActive: false,
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
  videoMode: null,
  videoNotice: null,
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const baroSubRef = useRef<{ remove: () => void } | null>(null);
  const unsubWritesRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const countRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<LiveState>(initialState);

  // Reflect each written point (from either capture path) into live UI state.
  const attachWriteListener = useCallback(() => {
    unsubWritesRef.current?.();
    unsubWritesRef.current = subscribeWrites((p: WrittenPoint) => {
      countRef.current += 1;
      setState((s) => ({
        ...s,
        lat: p.lat,
        lon: p.lon,
        speedMph: p.speed * 2.23694,
        bearing: p.bearing,
        accuracy: p.accuracy,
        altitude: p.altitude,
        altitudeAccuracy: p.altitudeAccuracy,
        batteryPct: p.battery,
        batteryCharging: p.charging,
        pointCount: countRef.current,
        lastWriteAt: Date.now(),
      }));
    });
  }, []);

  // Barometer (if present): keep the latest reading in the shared holder so
  // both capture paths snapshot it per point.
  const startBarometer = useCallback(async () => {
    latestBaro.pressure = null;
    latestBaro.relativeAltitude = null;
    try {
      if (await Barometer.isAvailableAsync()) {
        baroSubRef.current = Barometer.addListener((d) => {
          latestBaro.pressure = typeof d.pressure === 'number' ? d.pressure : null;
          latestBaro.relativeAltitude =
            typeof (d as any).relativeAltitude === 'number'
              ? (d as any).relativeAltitude
              : null;
        });
      }
    } catch {
      // no barometer; pressure stays null
    }
  }, []);

  useEffect(() => {
    (async () => {
      await getDb(); // create schema before any Start
      deviceIdRef.current = await getDeviceId();

      // If the OS kept (or relaunched) the background task while the app UI was
      // killed mid-recording, resume the open session instead of orphaning it.
      try {
        const active = await getActiveSession();
        const bgRunning =
          !IS_EXPO_GO && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK));
        if (active && bgRunning) {
          sessionIdRef.current = active.sessionId;
          countRef.current = await countPointsForSession(active.sessionId);
          attachWriteListener();
          await startBarometer();
          setState((s) => ({
            ...s,
            isTracking: true,
            backgroundActive: true,
            sessionId: active.sessionId,
            pointCount: countRef.current,
          }));
        } else if (active && !bgRunning) {
          // Recording died with the app (foreground mode) — close the session.
          await endSession(active.sessionId);
          await clearActiveSession();
          setState((s) => ({ ...s, lastSessionId: active.sessionId }));
        }
      } catch {
        // restore is best-effort; a fresh Start always works
      }

      setReady(true);
    })();
    return () => {
      subRef.current?.remove();
      subRef.current = null;
      baroSubRef.current?.remove();
      baroSubRef.current = null;
      unsubWritesRef.current?.();
      unsubWritesRef.current = null;
      deactivateKeepAwake(KEEP_AWAKE_TAG); // never leave the screen pinned awake
    };
  }, [attachWriteListener, startBarometer]);

  const start = useCallback(async () => {
    if (sessionIdRef.current != null) return; // already tracking

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setState((s) => ({ ...s, error: 'Location permission denied' }));
      return;
    }

    // Background recording needs a custom build + "Allow all the time".
    let background = false;
    let backgroundNotice: string | null = null;
    if (!IS_EXPO_GO) {
      try {
        const bg = await Location.requestBackgroundPermissionsAsync();
        background = bg.status === 'granted';
        if (!background) {
          backgroundNotice =
            'Background permission denied — recording works only while the app is open. ' +
            'Enable "Allow all the time" in location settings for screen-off tracking.';
        }
      } catch {
        background = false;
      }
    }

    const deviceId = deviceIdRef.current;
    const sessionId = await startSession(deviceId, null);
    sessionIdRef.current = sessionId;
    countRef.current = 0;
    await setActiveSession(sessionId, deviceId);
    setState((s) => ({
      ...initialState,
      isTracking: true,
      backgroundActive: background,
      sessionId,
      error: backgroundNotice,
      lastSessionId: s.lastSessionId,
    }));

    attachWriteListener();
    await startBarometer();

    // Video capture — camera is ALWAYS on while tracking (no user toggle).
    // Never blocks GPS tracking: whatever the capability outcome (dual ->
    // single -> unavailable), the ride still records.
    try {
      const cap = await startCapture(sessionId, deviceId);
      setState((s) => ({
        ...s,
        videoMode: cap.mode === 'unavailable' ? null : cap.mode,
        videoNotice: cap.notice,
      }));
      // Cameras cannot capture with the screen off (OS restriction), and the
      // library cannot bind to a camera foreground service — so while video
      // runs, the screen must not auto-lock. GPS alone doesn't need this
      // (its foreground service survives screen-off), video always does.
      if (cap.mode !== 'unavailable') {
        try {
          await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        } catch {
          // non-fatal; video simply stops if the screen locks
        }
      }
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        videoNotice: `Video failed to start: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }

    if (background) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 10, // metres — distance-based sampling
        timeInterval: 0, // Android-only; 0 = no minimum wait
        activityType: Location.LocationActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'geowise is recording your trip',
          notificationBody: 'Location tracking stays on until you press Stop.',
          killServiceOnDestroy: false,
        },
      });
    } else {
      // Foreground-only fallback (Expo Go, or background permission denied):
      // keep the screen on — lock = recording stops.
      try {
        await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      } catch {
        // non-fatal; tracking proceeds without it
      }
      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 10,
          timeInterval: 0,
        },
        async (loc) => {
          const sid = sessionIdRef.current;
          if (sid == null) return;
          await writeLocation(sid, deviceId, loc);
        }
      );
    }
  }, [attachWriteListener, startBarometer]);

  const stop = useCallback(async () => {
    try {
      await stopCapture(); // finalizes the in-flight video chunk
    } catch {
      // camera already stopped or was never started
    }
    subRef.current?.remove();
    subRef.current = null;
    baroSubRef.current?.remove();
    baroSubRef.current = null;
    unsubWritesRef.current?.();
    unsubWritesRef.current = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
    } catch {
      // task was never started (foreground mode) or already stopped
    }
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    await clearActiveSession();
    if (sid != null) await endSession(sid);
    setState((s) => ({
      ...s,
      isTracking: false,
      backgroundActive: false,
      sessionId: null,
      lastSessionId: sid ?? s.lastSessionId,
      videoMode: null,
      videoNotice: null,
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

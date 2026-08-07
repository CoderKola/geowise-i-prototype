import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { getActiveSession, getUploadSettings } from '../db/settings';
import { writeLocation } from './pointWriter';
import { drainQueue } from '../upload/uploader';

// Background location task. Must be defined at module top-level (imported from
// the app entry) so it exists even when the OS relaunches the app headlessly.
// Only used in custom builds — Expo Go falls back to the foreground watcher.

export const LOCATION_TASK = 'geowise-location-task';

// Opportunistic mid-trip upload: at most once a minute, piggybacked on a batch.
// Missed syncs are safe — the SQLite queue flushes on the next opportunity.
const BG_SYNC_MIN_INTERVAL_MS = 60_000;
let lastBgSyncAt = 0;

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: LocationObject[] };

  const active = await getActiveSession();
  if (active == null) return; // no session open — stale task delivery

  const deviceId = active.deviceId;
  for (const loc of locations) {
    try {
      await writeLocation(active.sessionId, deviceId, loc);
    } catch {
      // never let one bad point abort the rest of the batch
    }
  }

  const now = Date.now();
  if (now - lastBgSyncAt >= BG_SYNC_MIN_INTERVAL_MS) {
    lastBgSyncAt = now;
    const s = await getUploadSettings();
    if (s.uploadEnabled && s.serverUrl && s.uploadToken) {
      // Fire-and-forget, NEVER awaited: a slow upload must not delay this
      // task's completion, or the OS re-delivers the location batch and every
      // fix gets recorded again (the session-3 7x-duplication bug). The
      // foreground service keeps the JS runtime alive while it finishes.
      drainQueue(s.serverUrl, s.uploadToken, 5).catch(() => {
        // offline or server down — points stay queued, retry next minute
      });
    }
  }
});

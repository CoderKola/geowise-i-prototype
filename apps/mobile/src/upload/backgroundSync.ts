import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { countPending } from '../db/points';
import { countPendingSegments } from '../db/media';
import { getUploadSettings } from '../db/settings';
import { drainQueue } from './uploader';

// OS-scheduled upload flush (WorkManager on Android, BGTaskScheduler on iOS).
// This is what keeps the queue draining when the app is backgrounded or killed
// AFTER a ride ends — the location task only piggybacks syncs while tracking.
// Must be defined at module top-level (imported from the app entry) so it
// exists when the OS launches the app headlessly. Custom builds only; in
// Expo Go registration silently no-ops and foreground sync still covers it.

export const UPLOAD_FLUSH_TASK = 'geowise-upload-flush';

// Android WorkManager enforces a 15-minute floor for periodic work; the OS
// decides exact timing, so treat this as "roughly every 15+ minutes".
const FLUSH_INTERVAL_MINUTES = 15;

TaskManager.defineTask(UPLOAD_FLUSH_TASK, async () => {
  try {
    if ((await countPending()) === 0 && (await countPendingSegments()) === 0) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    const s = await getUploadSettings();
    if (!s.uploadEnabled || !s.serverUrl || !s.uploadToken) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    const r = await drainQueue(s.serverUrl, s.uploadToken);
    return r.error
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Idempotent — safe to call on every app start and settings change.
export async function ensureBackgroundFlushRegistered(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(UPLOAD_FLUSH_TASK)) return;
    await BackgroundTask.registerTaskAsync(UPLOAD_FLUSH_TASK, {
      minimumInterval: FLUSH_INTERVAL_MINUTES,
    });
  } catch {
    // Expo Go or restricted platform — uploads still run in the foreground.
  }
}

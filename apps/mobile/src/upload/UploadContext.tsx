import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { getUploadSettings, saveUploadSettings } from '../db/settings';
import { countPending, countUploaded } from '../db/points';
import { countPendingSegments, countUploadedSegments } from '../db/media';
import { cleanupUploadedSegments } from '../db/mediaCleanup';
import { drainQueue } from './uploader';
import { ensureBackgroundFlushRegistered } from './backgroundSync';

const INTERVAL_MS = 12000; // foreground sync cadence

interface UploadState {
  ready: boolean;
  serverUrl: string;
  uploadToken: string;
  uploadEnabled: boolean;
  pending: number;
  sent: number;
  pendingMedia: number;
  sentMedia: number;
  lastStatus: string | null;
  lastSyncAt: number | null;
}

interface UploadContextValue extends UploadState {
  setServerUrl: (v: string) => void;
  setUploadToken: (v: string) => void;
  setUploadEnabled: (v: boolean) => void;
  save: () => Promise<void>;
  syncNow: () => Promise<void>;
  refreshCounts: () => Promise<void>;
}

const initialState: UploadState = {
  ready: false,
  serverUrl: '',
  uploadToken: '',
  uploadEnabled: false,
  pending: 0,
  sent: 0,
  pendingMedia: 0,
  sentMedia: 0,
  lastStatus: null,
  lastSyncAt: null,
};

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UploadState>(initialState);
  const busyRef = useRef(false);
  // mirror of the current config for the interval closure (avoids stale reads)
  const cfgRef = useRef({ url: '', token: '', enabled: false });

  // load persisted settings + initial counts
  useEffect(() => {
    (async () => {
      const s = await getUploadSettings();
      cfgRef.current = { url: s.serverUrl, token: s.uploadToken, enabled: s.uploadEnabled };
      const [pending, sent] = await Promise.all([countPending(), countUploaded()]);
      setState((prev) => ({
        ...prev,
        ready: true,
        serverUrl: s.serverUrl,
        uploadToken: s.uploadToken,
        uploadEnabled: s.uploadEnabled,
        pending,
        sent,
      }));
      // OS-level flush so the queue drains even if the app is backgrounded
      // or killed after a ride. The task itself checks the Auto toggle.
      await ensureBackgroundFlushRegistered();
      // App-start retention pass: drop synced video files older than 24h.
      await cleanupUploadedSegments().catch(() => {});
    })();
  }, []);

  // keep cfgRef in sync with edited fields
  useEffect(() => {
    cfgRef.current = {
      url: state.serverUrl,
      token: state.uploadToken,
      enabled: state.uploadEnabled,
    };
  }, [state.serverUrl, state.uploadToken, state.uploadEnabled]);

  const refreshCounts = useCallback(async () => {
    const [pending, sent, pendingMedia, sentMedia] = await Promise.all([
      countPending(),
      countUploaded(),
      countPendingSegments(),
      countUploadedSegments(),
    ]);
    setState((prev) => ({ ...prev, pending, sent, pendingMedia, sentMedia }));
  }, []);

  // force=true is the manual "Sync now" path — flushes even when auto is off.
  const runSync = useCallback(async (force = false) => {
    const { url, token, enabled } = cfgRef.current;
    if (!force && !enabled) return;
    if (busyRef.current) return;
    if (AppState.currentState !== 'active') return; // foreground-only
    busyRef.current = true;
    try {
      // Drain the whole queue, not just one batch — after a ride with a
      // backlog this catches the server up in one tick instead of hours.
      const r = await drainQueue(url, token);
      setState((prev) => ({
        ...prev,
        lastStatus: r.error
          ? `error: ${r.error}`
          : r.sent > 0 || r.sentMedia > 0
            ? `sent ${r.sent}${r.sentMedia > 0 ? ` + ${r.sentMedia} clips` : ''}`
            : 'up to date',
        lastSyncAt: Date.now(),
      }));
      await refreshCounts();
    } finally {
      busyRef.current = false;
    }
  }, [refreshCounts]);

  // periodic tick: always refresh counts; sync only when enabled/active
  useEffect(() => {
    const tick = async () => {
      await cleanupUploadedSegments().catch(() => {}); // no-op unless synced chunks aged out
      await refreshCounts();
      await runSync();
    };
    const id = setInterval(tick, INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshCounts, runSync]);

  const setServerUrl = useCallback((v: string) => setState((p) => ({ ...p, serverUrl: v })), []);
  const setUploadToken = useCallback((v: string) => setState((p) => ({ ...p, uploadToken: v })), []);
  // Auto/Manual is a persisted preference (no Save button on Track) — write it now.
  const setUploadEnabled = useCallback((v: boolean) => {
    setState((p) => ({ ...p, uploadEnabled: v }));
    cfgRef.current = { ...cfgRef.current, enabled: v };
    saveUploadSettings({
      serverUrl: cfgRef.current.url,
      uploadToken: cfgRef.current.token,
      uploadEnabled: v,
    }).catch(() => {});
  }, []);

  const save = useCallback(async () => {
    await saveUploadSettings({
      serverUrl: cfgRef.current.url,
      uploadToken: cfgRef.current.token,
      uploadEnabled: cfgRef.current.enabled,
    });
  }, []);

  const syncNow = useCallback(async () => {
    await runSync(true); // manual flush, ignores the enabled flag
  }, [runSync]);

  return (
    <UploadContext.Provider
      value={{ ...state, setServerUrl, setUploadToken, setUploadEnabled, save, syncNow, refreshCounts }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}

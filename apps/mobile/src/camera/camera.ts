import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import type * as VC from 'react-native-vision-camera';
import { insertSegment } from '../db/media';
import type { CameraCapability, CameraFacing } from './types';

// Dashcam-style segmented video capture. Records short MP4 chunks per camera
// (front + back simultaneously when the hardware supports multi-cam) so each
// finished chunk can be uploaded near-live through the existing points pipeline.
//
// Capability ladder:
//   dual        -> multi-cam session with front + back cameras
//   single      -> back (or front) camera only, with a notice
//   unavailable -> Expo Go, no permission, or no camera at all
//
// IMPORTANT: by default cameras do not record while the app is backgrounded /
// screen off. We finalize the current chunk on background and resume recording
// when the app becomes active again. GPS tracking is unaffected. The
// SCREEN_OFF_CAPTURE_ENABLED spike flag below (default OFF) is the experimental
// exception — see its comment.

const SEGMENT_SECONDS = 15;
const VIDEO_TARGET = { width: 720, height: 1280 }; // 720p — battery/bandwidth compromise

// ~3 Mbps H.264 at 720p (plan item 5). vision-camera v5 passes this number
// straight to CameraX's Recorder.Builder.setTargetVideoEncodingBitRate(), so
// no preset mapping is involved. Codec selection is iOS-only in v5 (Android's
// setOutputSettings is a no-op), so chunks stay H.264 — the CameraX
// camcorder-profile default — and the ~2 Mbps HEVC option is not reachable
// without a library upgrade. 3 Mbps ≈ 5.6 MB per 15 s chunk.
const VIDEO_BITRATE_BPS = 3_000_000;

// Cap capture at 20 fps. Field data (8/10 ride) showed the encoder can't
// sustain dual 720p30: chunks held 15 s of frames across up to ~25 s of wall
// time, i.e. ~40% of real time was never captured ("choppy" footage). 20 fps
// cuts pipeline load by a third and is plenty for ride review. Applied as a
// session CONSTRAINT — vision-camera negotiates the closest supported rate,
// so an unsupported value degrades gracefully instead of failing.
const VIDEO_FPS = 20;

// EXPERIMENTAL SPIKE (plan items 1+3), default OFF: keep recording while the
// screen is off / app is backgrounded. Requires an EAS build with the
// camera-type foreground service (plugins/withCameraForegroundService.js) and
// the patched vision-camera lifecycle keep-alive
// (patches/react-native-vision-camera+5.2.2.patch). When false, behavior is
// exactly the shipping path: backgrounding finalizes the in-flight chunks and
// recording resumes on 'active'.
const SCREEN_OFF_CAPTURE_ENABLED = true; // ON for the device test build — flip off if screen-off rides misbehave

const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// vision-camera binds its Nitro native module the moment the package is
// evaluated, which crashes in Expo Go where that native code doesn't exist.
// This deferred require is the documented exception to the top-level-imports
// rule: static imports above are type-only (erased at compile time), and the
// runtime binding happens lazily — never in Expo Go.
let vcModule: typeof VC | null = null;
function getVisionCamera(): typeof VC | null {
  if (IS_EXPO_GO) return null;
  if (vcModule == null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      vcModule = require('react-native-vision-camera') as typeof VC;
    } catch {
      return null; // native module missing (e.g. stale build)
    }
  }
  return vcModule;
}

interface Capture {
  facing: CameraFacing;
  videoOutput: VC.CameraVideoOutput;
  previewOutput: VC.CameraPreviewOutput;
  recorder: VC.Recorder | null;
  /**
   * Synchronous guard closing the async gap in startNextSegment (guard check ->
   * await createRecorder -> assignment). Without it, two concurrent callers
   * (segment rollover + AppState 'active') could both start a recording on the
   * same output — the second start crashes NATIVELY on Android
   * ("A recording is already in progress"), killing the whole app.
   */
  starting: boolean;
  /** single pending restart timer per capture — never stack retries */
  restartTimer: ReturnType<typeof setTimeout> | null;
  segmentStartedAt: number;
}

interface CaptureState {
  sessionId: number;
  deviceId: string | null;
  session: VC.CameraSession;
  captures: Capture[];
  active: boolean;
}

let current: CaptureState | null = null;
let appStateSub: NativeEventSubscription | null = null;

// --- preview outputs for the Track screen tiles ---

export interface PreviewHandle {
  facing: CameraFacing;
  /** A vision-camera CameraPreviewOutput; typed loosely so shared UI code never imports native types. */
  output: unknown;
}

type PreviewListener = (previews: PreviewHandle[]) => void;
const previewListeners = new Set<PreviewListener>();

export function getPreviews(): PreviewHandle[] {
  if (!current) return [];
  return current.captures.map((c) => ({ facing: c.facing, output: c.previewOutput }));
}

export function subscribePreviews(cb: PreviewListener): () => void {
  previewListeners.add(cb);
  return () => previewListeners.delete(cb);
}

function notifyPreviewListeners(): void {
  const previews = getPreviews();
  previewListeners.forEach((cb) => cb(previews));
}

// --- capability detection ---

function pickFrontBackCombo(
  combos: VC.CameraDevice[][]
): { front: VC.CameraDevice; back: VC.CameraDevice } | null {
  for (const combo of combos) {
    const front = combo.find((d) => d.position === 'front');
    const back = combo.find((d) => d.position === 'back');
    if (front && back) return { front, back };
  }
  return null;
}

export async function getCapability(): Promise<CameraCapability> {
  const vc = getVisionCamera();
  if (vc == null) {
    return {
      mode: 'unavailable',
      notice: 'Video not supported in Expo Go — use the custom app build.',
    };
  }
  try {
    const factory = await vc.VisionCamera.createDeviceFactory();
    if (vc.VisionCamera.supportsMultiCamSessions) {
      const combo = pickFrontBackCombo(factory.supportedMultiCamDeviceCombinations);
      if (combo) return { mode: 'dual', notice: null };
    }
    const single = factory.getDefaultCamera('back') ?? factory.getDefaultCamera('front');
    if (single) {
      return {
        mode: 'single',
        notice: 'Dual camera not supported on this device — recording one camera only.',
      };
    }
    return { mode: 'unavailable', notice: 'No camera available on this device.' };
  } catch (e: unknown) {
    return {
      mode: 'unavailable',
      notice: `Camera unavailable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// --- segment recording loop ---

function segmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'segments');
  try {
    if (!dir.exists) dir.create();
  } catch {
    // already exists or created concurrently
  }
  return dir;
}

/** file:// URI -> plain filesystem path (what vision-camera's Recorder expects). */
function toFsPath(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}

// Breather between segments: when maxDuration finalizes a chunk, the native
// (CameraX) recorder may not be ready for a new recording the instant the
// finish callback fires. Starting too early throws natively and kills the app,
// so every restart goes through this small delay.
const RESTART_DELAY_MS = 300;
const ERROR_RETRY_DELAY_MS = 2000;

function scheduleRestart(capture: Capture, delayMs = RESTART_DELAY_MS): void {
  if (capture.restartTimer != null) return; // one pending restart at a time
  capture.restartTimer = setTimeout(() => {
    capture.restartTimer = null;
    startNextSegment(capture).catch(() => {});
  }, delayMs);
}

async function onSegmentFinished(capture: Capture, filePath: string): Promise<void> {
  const state = current;
  const endedAt = Date.now();
  const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
  capture.recorder = null;

  if (state != null) {
    let size: number | null = null;
    try {
      size = new File(fileUri).size ?? null;
    } catch {
      // size is best-effort metadata
    }
    try {
      await insertSegment({
        session_id: state.sessionId,
        device_id: state.deviceId,
        facing: capture.facing,
        started_at: capture.segmentStartedAt,
        ended_at: endedAt,
        file_uri: fileUri,
        size_bytes: size,
      });
    } catch {
      // never let a bad row kill the recording loop
    }
  }

  if (state?.active && (SCREEN_OFF_CAPTURE_ENABLED || AppState.currentState === 'active')) {
    scheduleRestart(capture);
  }
}

async function startNextSegment(capture: Capture): Promise<void> {
  const state = current;
  if (state == null || !state.active) return;
  if (capture.recorder != null || capture.starting) return;
  // Without the screen-off spike, backgrounded = no recording; the AppState
  // listener resumes the loop on 'active'.
  if (!SCREEN_OFF_CAPTURE_ENABLED && AppState.currentState !== 'active') return;

  capture.starting = true;
  try {
    const dir = segmentsDir();
    const name = `s${state.sessionId}-${capture.facing}-${Date.now()}.mp4`;
    const filePath = `${toFsPath(dir.uri).replace(/\/$/, '')}/${name}`;

    const recorder = await capture.videoOutput.createRecorder({
      filePath,
      maxDuration: SEGMENT_SECONDS,
    });
    capture.segmentStartedAt = Date.now();
    await recorder.startRecording(
      (finishedPath) => {
        void onSegmentFinished(capture, finishedPath);
      },
      () => {
        // Recording error (interruption, resource pressure). Drop this chunk and
        // retry shortly — the loop stops itself when capture is no longer active.
        capture.recorder = null;
        scheduleRestart(capture, ERROR_RETRY_DELAY_MS);
      }
    );
    capture.recorder = recorder;
    // stopCapture ran while we were starting — finalize the orphan right away.
    if (current?.active !== true) {
      try {
        if (recorder.isRecording) await recorder.stopRecording();
      } catch {
        // already finalized by the session teardown
      }
    }
  } catch {
    // Start failed (e.g. previous segment still finalizing) — retry shortly.
    scheduleRestart(capture, ERROR_RETRY_DELAY_MS);
  } finally {
    capture.starting = false;
  }
}

async function stopActiveRecorders(): Promise<void> {
  if (!current) return;
  for (const capture of current.captures) {
    const rec = capture.recorder;
    if (rec != null) {
      try {
        if (rec.isRecording) await rec.stopRecording(); // finalizes -> onSegmentFinished
      } catch {
        capture.recorder = null;
      }
    }
  }
}

// Spike path (SCREEN_OFF_CAPTURE_ENABLED): the camera-type foreground service
// + patched vision-camera lifecycle keep the session alive across host pause,
// so in-flight recordings continue and rotate on the normal maxDuration cycle.
// If a recorder looks unhealthy (native object dead, recording already ended),
// fall back to the safe finalize-on-background behavior so nothing is lost.
function keepRecordingThroughBackground(): void {
  if (!current) return;
  try {
    for (const capture of current.captures) {
      if (capture.recorder != null && !capture.recorder.isRecording) {
        capture.recorder = null;
        scheduleRestart(capture, ERROR_RETRY_DELAY_MS);
      }
    }
  } catch {
    void stopActiveRecorders();
  }
}

function handleAppStateChange(status: AppStateStatus): void {
  if (!current?.active) return;
  if (status === 'active') {
    for (const capture of current.captures) {
      scheduleRestart(capture);
    }
  } else if (SCREEN_OFF_CAPTURE_ENABLED) {
    keepRecordingThroughBackground();
  } else {
    // Screen off / backgrounded: cameras are not allowed to keep capturing.
    // Finalize the in-flight chunks so nothing is lost.
    void stopActiveRecorders();
  }
}

// --- public start/stop, called from TrackingContext ---

export async function startCapture(
  sessionId: number,
  deviceId: string | null
): Promise<CameraCapability> {
  const vc = getVisionCamera();
  if (vc == null) {
    return {
      mode: 'unavailable',
      notice: 'Video not supported in Expo Go — use the custom app build.',
    };
  }
  if (current != null) await stopCapture(); // never two sessions at once

  try {
    const { VisionCamera } = vc;

    if (VisionCamera.cameraPermissionStatus !== 'authorized') {
      const granted = await VisionCamera.requestCameraPermission();
      if (!granted) {
        return { mode: 'unavailable', notice: 'Camera permission denied — video disabled.' };
      }
    }

    const factory = await VisionCamera.createDeviceFactory();
    let devices: { facing: CameraFacing; device: VC.CameraDevice }[] = [];
    let capability: CameraCapability;

    const combo = VisionCamera.supportsMultiCamSessions
      ? pickFrontBackCombo(factory.supportedMultiCamDeviceCombinations)
      : null;
    if (combo) {
      devices = [
        { facing: 'back', device: combo.back },
        { facing: 'front', device: combo.front },
      ];
      capability = { mode: 'dual', notice: null };
    } else {
      const back = factory.getDefaultCamera('back');
      const front = back == null ? factory.getDefaultCamera('front') : undefined;
      const single = back ?? front;
      if (single == null) {
        return { mode: 'unavailable', notice: 'No camera available on this device.' };
      }
      devices = [{ facing: back != null ? 'back' : 'front', device: single }];
      capability = {
        mode: 'single',
        notice: 'Dual camera not supported on this device — recording one camera only.',
      };
    }

    const session = await VisionCamera.createCameraSession(devices.length > 1);
    const captures: Capture[] = devices.map(({ facing }) => ({
      facing,
      videoOutput: VisionCamera.createVideoOutput({
        targetResolution: VIDEO_TARGET,
        targetBitRate: VIDEO_BITRATE_BPS,
        enableAudio: false, // ride video only — saves battery, bandwidth, and a permission
      }),
      previewOutput: VisionCamera.createPreviewOutput(),
      recorder: null,
      starting: false,
      restartTimer: null,
      segmentStartedAt: 0,
    }));

    await session.configure(
      devices.map(({ facing, device }, i) => ({
        input: device,
        outputs: [
          { output: captures[i].previewOutput, mirrorMode: 'auto' as const },
          { output: captures[i].videoOutput, mirrorMode: facing === 'front' ? ('on' as const) : ('off' as const) },
        ],
        constraints: [{ fps: VIDEO_FPS }],
      }))
    );
    await session.start();

    current = { sessionId, deviceId, session, captures, active: true };
    appStateSub = AppState.addEventListener('change', handleAppStateChange);
    notifyPreviewListeners();

    for (const capture of captures) {
      startNextSegment(capture).catch(() => {});
    }
    return capability;
  } catch (e: unknown) {
    current = null;
    return {
      mode: 'unavailable',
      notice: `Camera failed to start: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function stopCapture(): Promise<void> {
  const state = current;
  if (state == null) return;
  state.active = false;
  appStateSub?.remove();
  appStateSub = null;
  for (const capture of state.captures) {
    if (capture.restartTimer != null) {
      clearTimeout(capture.restartTimer);
      capture.restartTimer = null;
    }
  }

  await stopActiveRecorders();
  try {
    await state.session.stop();
  } catch {
    // session already stopped or interrupted
  }
  current = null;
  notifyPreviewListeners();
}

export function isCapturing(): boolean {
  return current?.active === true;
}

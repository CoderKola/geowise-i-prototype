// Shared camera types — safe to import from anywhere (no native imports).

export type CameraFacing = 'front' | 'back';

export type CameraMode = 'dual' | 'single' | 'unavailable';

export interface CameraCapability {
  mode: CameraMode;
  /** User-facing notice when degraded ("Dual camera not supported…"), null when dual. */
  notice: string | null;
}

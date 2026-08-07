import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

// device_id from the platform vendor id (SSAID on Android / IDFV on iOS).
// IMEI is impossible on modern OSes — this is the closest stable per-install id.
// Android-first: SSAID is the product path. The IDFV branch stays because the
// iPhone Expo Go dev loop still exercises it.

let cached: string | null | undefined;

export async function getDeviceId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    if (Platform.OS === 'ios') {
      cached = await Application.getIosIdForVendorAsync();
    } else if (Platform.OS === 'android') {
      // guarded: API name has shifted across expo-application versions
      cached = (Application as any).getAndroidId?.() ?? null;
    } else {
      cached = null;
    }
  } catch {
    cached = null;
  }
  return cached ?? null;
}

// --- device identity metadata (static per install, stamped on every point) ---

export interface DeviceMeta {
  platform: string | null; // "iOS" | "Android" | ...
  device_model: string | null; // e.g. "Pixel 7", "iPhone 12"
  device_type: string | null; // "phone" | "tablet" | "desktop" | "tv" | "unknown"
  os_version: string | null;
}

function mapDeviceType(t: Device.DeviceType | null): string | null {
  if (t == null) return null;
  switch (t) {
    case Device.DeviceType.PHONE:
      return 'phone';
    case Device.DeviceType.TABLET:
      return 'tablet';
    case Device.DeviceType.DESKTOP:
      return 'desktop';
    case Device.DeviceType.TV:
      return 'tv';
    case Device.DeviceType.UNKNOWN:
      return 'unknown';
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
}

let metaCache: DeviceMeta | null = null;

// Match the server schema's max lengths — some Android devices report a very
// long osName, which would otherwise fail strict validation.
function clamp(v: string | null, max: number): string | null {
  return v == null ? null : v.slice(0, max);
}

export function getDeviceMeta(): DeviceMeta {
  if (!metaCache) {
    metaCache = {
      // Platform.OS is a deterministic "ios" | "android" — Device.osName has
      // returned build fingerprints on some Android devices, which breaks the
      // dashboard's platform-based altitude normalization.
      platform: clamp(Platform.OS, 32),
      device_model: clamp(Device.modelName, 64),
      device_type: mapDeviceType(Device.deviceType),
      os_version: clamp(Device.osVersion, 32),
    };
  }
  return metaCache;
}

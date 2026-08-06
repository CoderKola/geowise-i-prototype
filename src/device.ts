import { Platform } from 'react-native';
import * as Application from 'expo-application';

// device_id from the platform vendor id (IDFV on iOS / SSAID on Android).
// IMEI is impossible on modern OSes — this is the closest stable per-install id.
// iPhone-first: the iOS path is the one that matters for the POC.

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

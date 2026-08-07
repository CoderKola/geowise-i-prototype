import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';

// Battery-optimization (Doze) exemption (plan item 2). OEM battery managers
// can kill background services on unplugged rides; the exemption keeps the
// tracking foreground service alive. This app is sideloaded and continuous
// tracking is the documented acceptable use case, so we use the direct
// ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS system dialog (the path Google
// Play restricts) — it also works on Samsung devices where the settings-list
// intent can be missing. Requires the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
// permission declared in app.json.
//
// Android custom builds only: Expo Go would target Expo Go's own package
// (which lacks the permission), and iOS has no equivalent concept.

const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const SUPPORTED = Platform.OS === 'android' && !IS_EXPO_GO;

/** True when the app is still subject to battery optimization and the one-tap exemption prompt should be shown. */
export async function needsBatteryExemption(): Promise<boolean> {
  if (!SUPPORTED) return false;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false; // can't check — don't nag
  }
}

/** Open the system "ignore battery optimizations?" dialog; resolves when the dialog closes. */
export async function requestBatteryExemption(): Promise<void> {
  if (!SUPPORTED) return;
  const pkg = Application.applicationId;
  if (pkg == null) return;
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
    { data: `package:${pkg}` }
  );
}

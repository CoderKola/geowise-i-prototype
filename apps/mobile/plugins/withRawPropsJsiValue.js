const { withMainApplication } = require('@expo/config-plugins');

// vision-camera 5 (Nitro views) passes HybridObjects as raw view props, which
// requires React Native's jsi::Value-backed RawProps. The `useRawPropsJsiValue`
// feature flag is default-OFF in RN 0.81 (Expo SDK 54) — without it, rendering
// a <PreviewView> hard-crashes the app with:
//   "Cannot cast dynamic to a jsi::Value type. Please use the
//    'useRawPropsJsiValue' feature flag..."
// RN enabled this flag by default in later releases; this plugin backports it.
//
// Placement is delicate (both alternatives crash on launch — learned the hard way):
//  - Calling ReactNativeFeatureFlags.override() BEFORE loadReactNative() dies with
//    "SoLoader.init() not yet called", and even with SoLoader initialized, RN's
//    DefaultNewArchitectureEntryPoint.load() performs the single allowed
//    override() itself -> "Feature flags cannot be overridden more than once".
//  - So we must run AFTER loadReactNative() and use dangerouslyForceOverride(),
//    replicating the same values RN's stable new-arch overrides just set
//    (see ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android) plus our flag.
//    This still runs before the React instance / Fabric are created (that
//    happens when the first Activity loads), so prop parsing sees the flag.
//
// Android-only: iOS currently runs in Expo Go where vision-camera is disabled
// entirely (a custom iOS build would need the equivalent flag).

const IMPORTS = `import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults`;

const OVERRIDE = `    // Required by react-native-vision-camera's Nitro views (see plugins/withRawPropsJsiValue.js)
    ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : ReactNativeNewArchitectureFeatureFlagsDefaults(BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
        override fun useFabricInterop(): Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override fun useTurboModules(): Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override fun useShadowNodeStateOnClone(): Boolean = true
        override fun useRawPropsJsiValue(): Boolean = true
      }
    )`;

function applyToMainApplication(src) {
  if (src.includes('useRawPropsJsiValue')) return src; // already applied
  src = src.replace(/^(package .+)$/m, `$1\n\n${IMPORTS}`);
  src = src.replace(/^(\s*loadReactNative\(this\))$/m, `$1\n${OVERRIDE}`);
  if (!src.includes('useRawPropsJsiValue')) {
    throw new Error('withRawPropsJsiValue: could not find loadReactNative(this) in MainApplication');
  }
  return src;
}

module.exports = function withRawPropsJsiValue(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withRawPropsJsiValue: expected a Kotlin MainApplication');
    }
    cfg.modResults.contents = applyToMainApplication(cfg.modResults.contents);
    return cfg;
  });
};

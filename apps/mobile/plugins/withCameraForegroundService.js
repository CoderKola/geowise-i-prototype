const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

// Screen-off video capture spike (plan items 1+3): Android only allows camera
// capture with the screen off when it runs under a foreground service of type
// "camera" (FOREGROUND_SERVICE_CAMERA permission + android:foregroundServiceType
// including "camera", started while the app is foreground).
//
// expo-location's library manifest declares its foreground service as
//   <service android:name=".services.LocationTaskService"
//            android:exported="false"
//            android:foregroundServiceType="location" />
// (full class: expo.modules.location.services.LocationTaskService) and its
// LocationTaskService calls the two-argument startForeground(id, notification),
// which inherits ALL manifest-declared types (FOREGROUND_SERVICE_TYPE_MANIFEST)
// — so extending the merged type to "location|camera" is sufficient; no code
// change in expo-location is needed.
//
// Library manifests are merged by Gradle at build time, so the override must
// come from the app's own manifest: we re-declare the service with
// tools:replace="android:foregroundServiceType". This plugin:
//   1. adds the android.permission.FOREGROUND_SERVICE_CAMERA permission, and
//   2. re-declares LocationTaskService with foregroundServiceType
//      "location|camera" + tools:replace (other attributes still merge from
//      the library manifest).

const SERVICE_NAME = 'expo.modules.location.services.LocationTaskService';

module.exports = function withCameraForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    // The tools namespace is required for tools:replace.
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    AndroidConfig.Permissions.addPermission(
      manifest,
      'android.permission.FOREGROUND_SERVICE_CAMERA'
    );

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!Array.isArray(app.service)) app.service = [];
    const attributes = {
      'android:name': SERVICE_NAME,
      'android:foregroundServiceType': 'location|camera',
      'tools:replace': 'android:foregroundServiceType',
    };
    const existing = app.service.find((s) => s.$?.['android:name'] === SERVICE_NAME);
    if (existing) {
      Object.assign(existing.$, attributes);
    } else {
      app.service.push({ $: attributes });
    }
    return cfg;
  });
};

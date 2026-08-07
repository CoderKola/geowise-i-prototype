# apps/mobile — agent instructions

Root `AGENTS.md` applies; this file adds mobile-only rules.

## Expo SDK 54 (hard constraint)

This app is pinned to **Expo SDK 54** — the owner's iPhone Expo Go caps at SDK 54,
and that iPhone is the fast dev loop. Read the versioned docs at
https://docs.expo.dev/versions/v54.0.0/ before writing any code. Do not bump the SDK.

## Android-first

- **Android is the product target.** Real testing runs on EAS APK builds
  (`npx eas-cli build --platform android --profile preview`). Background tracking,
  camera recording, and background sync only work in the APK.
- **The SDK 54 pin exists only for the iPhone Expo Go dev loop** (foreground-only
  fallback). Keep the `IS_EXPO_GO` fallback branches working — they are the dev path,
  not dead code.
- No iOS builds, no TestFlight. iOS-only config/options are dead weight; don't add them.

## Mobile-only rules

- **Expo Go vs custom build split:** anything touching native modules must handle
  both paths. Gate custom-build-only code on `IS_EXPO_GO` and degrade gracefully
  (see `camera.ts`, `TrackingContext.tsx`, `backgroundSync.ts` for the pattern).
- **Native dependencies:** add with `npx expo install <pkg>` so versions match SDK 54,
  then keep them exact-pinned (`.npmrc save-exact`). Never hand-edit a dependency
  version in `package.json`.
- Do not edit `patches/` or `plugins/withRawPropsJsiValue.js` without an explicit
  request — both are load-bearing for the Android camera build.
- Verify with `npx tsc --noEmit` in this directory.

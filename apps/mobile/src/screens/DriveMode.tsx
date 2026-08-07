import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as VC from 'react-native-vision-camera';
import { getPreviews, subscribePreviews, type PreviewHandle } from '../camera/camera';
import { useTracking } from '../location/TrackingContext';
import { useUpload } from '../upload/UploadContext';
import { ACCENT } from '../theme';

// Full-screen "drive mode" shown while tracking with an active camera:
// the preview fills the screen, driving stats overlay the top bar, and a
// pulsing red hue makes the recording state unmistakable.

const M_TO_FT = 3.28084;
const REC_RED = '#EF4444';

const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type PreviewViewComponent = typeof VC.NativePreviewView;

// Deferred require (documented exception to the top-level-imports rule): the
// native view binds vision-camera's Nitro module, which doesn't exist in Expo
// Go. DriveMode only renders when a capture is running — never in Expo Go.
let previewViewComponent: PreviewViewComponent | null = null;
function getPreviewView(): PreviewViewComponent | null {
  if (IS_EXPO_GO) return null;
  if (previewViewComponent == null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vc = require('react-native-vision-camera') as typeof VC;
      previewViewComponent = vc.NativePreviewView;
    } catch {
      return null;
    }
  }
  return previewViewComponent;
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && styles.statValueBig]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function DriveMode() {
  const t = useTracking();
  const u = useUpload();
  const insets = useSafeAreaInsets();
  const [previews, setPreviews] = useState<PreviewHandle[]>(getPreviews());

  useEffect(() => {
    setPreviews(getPreviews());
    return subscribePreviews(setPreviews);
  }, []);

  // Shared pulse for the REC dot and the red recording hue.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const PreviewView = getPreviewView();
  const primary = previews.find((p) => p.facing === 'back') ?? previews[0] ?? null;
  const pip = previews.find((p) => p !== primary) ?? null;

  const speed = t.speedMph == null ? 0 : t.speedMph;
  const altFt = t.altitude == null ? null : t.altitude * M_TO_FT;
  const battPct = t.batteryPct == null ? null : Math.round(t.batteryPct * 100);

  return (
    <View style={styles.root}>
      {PreviewView && primary ? (
        <PreviewView
          style={StyleSheet.absoluteFill}
          previewOutput={primary.output as VC.CameraPreviewOutput}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCam]}>
          <Text style={styles.noCamText}>camera starting…</Text>
        </View>
      )}

      {/* red recording hue around the frame */}
      <Animated.View pointerEvents="none" style={[styles.recHue, { opacity: pulse }]} />

      {/* driving stats top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.recRow}>
          <Animated.View style={[styles.recDot, { opacity: pulse }]} />
          <Text style={styles.recText}>REC</Text>
          <Text style={styles.recMeta}>
            {t.videoMode === 'dual' ? 'front + back' : 'single cam'} · {t.pointCount} pts
          </Text>
        </View>
        <View style={styles.statsRow}>
          <Stat label="MPH" value={speed.toFixed(1)} big />
          <Stat label="LAT" value={t.lat == null ? '—' : t.lat.toFixed(5)} />
          <Stat label="LON" value={t.lon == null ? '—' : t.lon.toFixed(5)} />
          <Stat label="ALT" value={altFt == null ? '—' : `${altFt.toFixed(0)} ft`} />
          <Stat
            label="BAT"
            value={battPct == null ? '—' : `${battPct}%${t.batteryCharging === 1 ? '⚡' : ''}`}
          />
        </View>
      </View>

      {/* front-camera picture-in-picture (dual mode) */}
      {PreviewView && pip ? (
        <View style={[styles.pip, { top: insets.top + 118 }]}>
          <PreviewView
            style={styles.pipPreview}
            previewOutput={pip.output as VC.CameraPreviewOutput}
            resizeMode="cover"
          />
          <Text style={styles.pipLabel}>{pip.facing}</Text>
        </View>
      ) : null}

      {/* bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.syncChip}>
          Pending {u.pending} · Sent {u.sent}
          {u.pendingMedia > 0 ? ` · ${u.pendingMedia} clips queued` : ''}
        </Text>
        <Button
          mode="contained"
          icon="stop"
          onPress={t.stop}
          buttonColor={ACCENT.stop}
          textColor="#FFFFFF"
          contentStyle={styles.stopBtnContent}
          labelStyle={styles.stopBtnLabel}
          style={styles.stopBtn}
        >
          Stop tracking
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  noCam: { alignItems: 'center', justifyContent: 'center' },
  noCamText: { color: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrainsMono_500Medium' },

  recHue: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 4,
    borderColor: REC_RED,
  },

  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: REC_RED },
  recText: {
    color: REC_RED,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  recMeta: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 11,
    marginLeft: 6,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  stat: { flexShrink: 1 },
  statLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  statValue: {
    color: '#FFFFFF',
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 15,
    marginTop: 1,
  },
  statValueBig: { fontFamily: 'JetBrainsMono_700Bold', fontSize: 22, marginTop: -3 },

  pip: {
    position: 'absolute',
    right: 12,
    width: 108,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: '#000000',
  },
  pipPreview: { width: '100%', aspectRatio: 3 / 4 },
  pipLabel: {
    position: 'absolute',
    left: 6,
    bottom: 4,
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 3,
  },

  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  syncChip: {
    color: '#FFFFFF',
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  stopBtn: { alignSelf: 'stretch', borderRadius: 16 },
  stopBtnContent: { height: 56 },
  stopBtnLabel: { fontSize: 16, fontFamily: 'Inter_700Bold' },
});

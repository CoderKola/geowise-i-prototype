import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Icon,
  IconButton,
  SegmentedButtons,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { useTracking } from '../location/TrackingContext';
import { useUpload } from '../upload/UploadContext';
import { needsBatteryExemption, requestBatteryExemption } from '../batteryOptimization';
import { getCapability } from '../camera/camera';
import type { CameraCapability } from '../camera/types';
import DriveMode from './DriveMode';
import { ACCENT } from '../theme';

const M_TO_FT = 3.28084;

// Bearing degrees -> friendly compass (e.g. 48 -> "NE 48°"). GPS reports -1 when
// stationary (no course), which we show as a dash.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function fmtHeading(deg: number | null): string {
  if (deg == null || deg < 0) return '—';
  const dir = COMPASS[Math.round(deg / 45) % 8];
  return `${dir} ${deg.toFixed(0)}°`;
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metric}>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant="titleMedium" style={[styles.metricValue, color ? { color } : null]}>
        {value}
      </Text>
    </View>
  );
}

// Compact header label for what the device's cameras can do.
function capabilityLabel(cap: CameraCapability | null): string {
  if (cap == null) return '…';
  switch (cap.mode) {
    case 'dual':
      return 'Dual cam';
    case 'single':
      return 'Single cam';
    case 'unavailable':
      return 'No camera';
    default: {
      const exhaustive: never = cap.mode;
      return exhaustive;
    }
  }
}

export default function TrackScreen() {
  const theme = useTheme();
  const t = useTracking();
  const u = useUpload();
  const [capability, setCapability] = useState<CameraCapability | null>(null);
  const [needsExemption, setNeedsExemption] = useState(false);
  const [exemptionDismissed, setExemptionDismissed] = useState(false);

  useEffect(() => {
    getCapability().then(setCapability).catch(() => {});
  }, []);

  // Re-check on mount and whenever tracking starts (Android custom builds
  // only — needsBatteryExemption resolves false on iOS/Expo Go).
  useEffect(() => {
    needsBatteryExemption().then(setNeedsExemption).catch(() => {});
  }, [t.isTracking]);

  const onRequestExemption = async () => {
    try {
      await requestBatteryExemption(); // resolves when the system dialog closes
    } catch {
      // dialog unavailable on this OEM — leave the notice up
    }
    needsBatteryExemption().then(setNeedsExemption).catch(() => {});
  };

  // Tracking with an active camera -> full-screen drive mode takes over.
  // No camera (Expo Go, permission denied) -> the stats layout below remains.
  if (t.isTracking && t.videoMode != null) {
    return <DriveMode />;
  }

  const speed = t.speedMph == null ? 0 : t.speedMph;
  const altFt = t.altitude == null ? null : t.altitude * M_TO_FT;
  const battPct = t.batteryPct == null ? null : Math.round(t.batteryPct * 100);
  const fixTime = t.lastWriteAt == null ? '—' : new Date(t.lastWriteAt).toLocaleTimeString();
  const mode = u.uploadEnabled ? 'auto' : 'manual';
  const ok = u.lastStatus != null && !u.lastStatus.startsWith('error');

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header mode="small" elevated>
        <Appbar.Content title="geowise" titleStyle={styles.brand} />
        {/* camera is always on while tracking — the icon reflects policy, not a toggle */}
        <View style={styles.recRow}>
          <Icon
            source={capability?.mode === 'unavailable' ? 'camera-off' : 'camera'}
            size={16}
            color={capability?.mode === 'unavailable' ? theme.colors.onSurfaceVariant : ACCENT.go}
          />
          <Text
            variant="labelMedium"
            style={{
              color:
                capability?.mode === 'unavailable'
                  ? theme.colors.onSurfaceVariant
                  : ACCENT.go,
            }}
          >
            {capabilityLabel(capability)}
          </Text>
        </View>
        <View style={styles.recRow}>
          <View
            style={[
              styles.dot,
              { backgroundColor: t.isTracking ? ACCENT.go : theme.colors.onSurfaceVariant },
            ]}
          />
          <Text variant="labelMedium" style={{ color: t.isTracking ? ACCENT.go : theme.colors.onSurfaceVariant }}>
            {t.isTracking ? 'Recording' : 'Idle'}
          </Text>
        </View>
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Battery optimization exemption — keeps OEM killers off the tracking service */}
        {needsExemption && !exemptionDismissed ? (
          <Surface style={styles.card} elevation={1}>
            <View style={styles.batteryNoticeRow}>
              <Icon source="battery-alert" size={22} color={ACCENT.amber} />
              <Text variant="bodySmall" style={[styles.flexShrink, { flex: 1 }]}>
                Battery optimization can stop recording mid-trip. Allow geowise to run
                unrestricted for reliable tracking.
              </Text>
              <IconButton
                icon="close"
                size={16}
                onPress={() => setExemptionDismissed(true)}
                style={styles.batteryNoticeClose}
              />
            </View>
            <Button
              mode="contained-tonal"
              icon="battery-check"
              onPress={onRequestExemption}
              style={styles.batteryNoticeBtn}
            >
              Allow unrestricted battery use
            </Button>
          </Surface>
        ) : null}

        {/* Speed hero */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Speed
          </Text>
          <View style={styles.speedRow}>
            <Text style={[styles.speedValue, { color: t.isTracking ? ACCENT.go : theme.colors.onSurface }]}>
              {speed.toFixed(1)}
            </Text>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
              mph
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.grid}>
            <Metric label="Latitude" value={t.lat == null ? '—' : t.lat.toFixed(5)} />
            <Metric label="Longitude" value={t.lon == null ? '—' : t.lon.toFixed(5)} />
            <Metric label="Altitude" value={altFt == null ? '—' : `${altFt.toFixed(0)} ft`} />
            <Metric label="Heading" value={fmtHeading(t.bearing)} />
            <Metric label="Accuracy" value={t.accuracy == null ? '—' : `±${t.accuracy.toFixed(0)} m`} />
            <Metric
              label="Battery"
              value={battPct == null ? '—' : `${battPct}%${t.batteryCharging === 1 ? ' ⚡' : ''}`}
              color={battPct != null && battPct <= 20 ? ACCENT.stop : undefined}
            />
          </View>

          <View style={styles.divider} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t.pointCount} points · last fix {fixTime}
          </Text>
          {t.error ? (
            <Text variant="bodySmall" style={{ color: ACCENT.stop, marginTop: 6 }}>
              {t.error}
            </Text>
          ) : null}
        </Surface>

        {/* Start / Stop */}
        <Button
          mode="contained"
          icon={t.isTracking ? 'stop' : 'play'}
          onPress={() => (t.isTracking ? t.stop() : t.start())}
          buttonColor={t.isTracking ? ACCENT.stop : ACCENT.go}
          textColor="#FFFFFF"
          contentStyle={styles.trackBtnContent}
          labelStyle={styles.trackBtnLabel}
          style={styles.trackBtn}
        >
          {t.isTracking ? 'Stop tracking' : 'Start tracking'}
        </Button>

        {/* Camera (always on while tracking — no toggle) */}
        <Surface style={styles.card} elevation={1}>
          <View style={styles.videoHeader}>
            <View style={styles.flexShrink}>
              <Text variant="titleSmall" style={styles.cardTitle}>
                Camera
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Always records while tracking (screen stays on). Starting a trip switches to
                full-screen camera mode.
              </Text>
            </View>
            <Icon
              source={capability?.mode === 'unavailable' ? 'camera-off' : 'camera'}
              size={22}
              color={
                capability?.mode === 'unavailable' ? theme.colors.onSurfaceVariant : ACCENT.go
              }
            />
          </View>
          {capability?.notice ? (
            <Text variant="bodySmall" style={{ color: ACCENT.amber, marginTop: 8 }}>
              {capability.notice}
            </Text>
          ) : capability?.mode === 'dual' ? (
            <Text variant="bodySmall" style={{ color: ACCENT.go, marginTop: 8 }}>
              Front + back cameras supported.
            </Text>
          ) : null}
          {t.videoNotice ? (
            <Text variant="bodySmall" style={{ color: ACCENT.amber, marginTop: 6 }}>
              {t.videoNotice}
            </Text>
          ) : null}
        </Surface>

        {/* Sync */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Sync to server
          </Text>
          <SegmentedButtons
            value={mode}
            onValueChange={(v) => u.setUploadEnabled(v === 'auto')}
            buttons={[
              { value: 'auto', label: 'Auto', icon: 'sync' },
              { value: 'manual', label: 'Manual', icon: 'gesture-tap' },
            ]}
          />

          {mode === 'manual' ? (
            <Button
              mode="contained-tonal"
              icon="cloud-upload-outline"
              onPress={u.syncNow}
              style={styles.syncNowBtn}
            >
              Sync now
            </Button>
          ) : null}

          <View style={styles.syncStatus}>
            <Text variant="bodyMedium">
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Pending </Text>
              <Text style={{ color: u.pending > 0 ? ACCENT.amber : theme.colors.onSurface }}>
                {u.pending}
              </Text>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>   Sent </Text>
              <Text style={{ color: ACCENT.go }}>{u.sent}</Text>
            </Text>
            <Text variant="bodySmall" style={{ color: ok ? ACCENT.go : theme.colors.onSurfaceVariant }}>
              {u.lastStatus ?? 'standby'}
            </Text>
          </View>
          {u.pendingMedia > 0 || u.sentMedia > 0 ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
              Video clips: {u.pendingMedia} pending · {u.sentMedia} sent
            </Text>
          ) : null}
          {!u.serverUrl ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
              Set the tunnel and token in Settings first.
            </Text>
          ) : null}
        </Surface>

        <Text variant="bodySmall" style={[styles.footnote, { color: theme.colors.onSurfaceVariant }]}>
          Points log every ~10 m of movement. Standing still reads idle, but recording is live.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  brand: { fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  scroll: { padding: 16, paddingBottom: 32, gap: 14 },
  card: { borderRadius: 20, padding: 18 },
  cardTitle: { marginBottom: 14, fontFamily: 'Inter_700Bold' },

  speedRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 },
  speedValue: { fontSize: 64, lineHeight: 68, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -2 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E1E5EA', marginVertical: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  metric: { width: '33.33%' },
  metricValue: { marginTop: 3, fontFamily: 'JetBrainsMono_500Medium' },

  trackBtn: { borderRadius: 16 },
  trackBtnContent: { height: 56 },
  trackBtnLabel: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  videoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexShrink: { flexShrink: 1 },

  batteryNoticeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  batteryNoticeClose: { margin: 0 },
  batteryNoticeBtn: { marginTop: 10, borderRadius: 12 },

  syncNowBtn: { marginTop: 12, borderRadius: 12 },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  footnote: { textAlign: 'center', marginTop: 4, lineHeight: 17 },
});

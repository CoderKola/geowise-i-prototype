import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  SegmentedButtons,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { useTracking } from '../location/TrackingContext';
import { useUpload } from '../upload/UploadContext';
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

export default function TrackScreen() {
  const theme = useTheme();
  const t = useTracking();
  const u = useUpload();

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

  syncNowBtn: { marginTop: 12, borderRadius: 12 },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  footnote: { textAlign: 'center', marginTop: 4, lineHeight: 17 },
});

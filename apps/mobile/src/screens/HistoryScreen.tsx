import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Card,
  IconButton,
  Text,
  useTheme,
} from 'react-native-paper';
import { useTracking } from '../location/TrackingContext';
import { useUpload } from '../upload/UploadContext';
import { listSessions } from '../db/sessions';
import {
  countPointsForSession,
  deleteSessionData,
  deleteUploadedPoints,
} from '../db/points';
import { deleteUploadedSegments } from '../db/media';
import { exportSessionCsv } from '../export/csv';
import { ACCENT } from '../theme';
import type { Session } from '../types';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Session ids are epoch-seconds since the reinstall-collision fix (legacy
// installs have small counter ids) — show a time-based title for epoch ids.
const EPOCH_ID_MIN = 1_000_000_000;

function sessionTitle(s: Session): string {
  if (s.label != null) return s.label;
  if (s.session_id >= EPOCH_ID_MIN) {
    return `Ride ${new Date(s.started_at).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  return `Session ${pad2(s.session_id)}`;
}

export default function HistoryScreen() {
  const theme = useTheme();
  const t = useTracking();
  const u = useUpload();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});

  const load = useCallback(async () => {
    const rows = await listSessions();
    setSessions(rows);
    const c: Record<number, number> = {};
    for (const s of rows) c[s.session_id] = await countPointsForSession(s.session_id);
    setCounts(c);
  }, []);

  // refresh whenever tracking stops (a session just closed) and on mount
  useEffect(() => {
    if (t.ready && !t.isTracking) load();
  }, [t.ready, t.isTracking, load]);

  const onExport = async (id: number) => {
    try {
      await exportSessionCsv(id);
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message ?? e));
    }
  };

  const onDelete = (s: Session) => {
    Alert.alert(
      'Delete session?',
      `"${sessionTitle(s)}" and its ${counts[s.session_id] ?? 0} points will be removed from this phone. Synced points stay on the server.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSessionData(s.session_id);
            await load();
            await u.refreshCounts();
          },
        },
      ]
    );
  };

  const onClear = () => {
    Alert.alert(
      'Clear synced points?',
      `${u.sent} uploaded points will be removed from this phone. They remain on the server. ${u.pending} un-synced points are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await deleteUploadedPoints();
            await deleteUploadedSegments(); // synced video files too
            await load();
            await u.refreshCounts();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header mode="small" elevated>
        <Appbar.Content title="History" titleStyle={styles.title} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scroll}>
        {sessions.length === 0 ? (
          <View style={styles.empty}>
            <IconButton icon="map-marker-path" size={30} iconColor={theme.colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No sessions yet. Start tracking to record one.
            </Text>
          </View>
        ) : (
          sessions.map((s) => {
            const active = t.sessionId === s.session_id;
            return (
              <Card key={s.session_id} style={styles.card} mode="elevated">
                <Card.Title
                  title={sessionTitle(s)}
                  titleStyle={styles.cardTitle}
                  subtitle={`${new Date(s.started_at).toLocaleString()} · ${counts[s.session_id] ?? 0} points${active ? ' · live' : ''}`}
                  subtitleStyle={active ? { color: ACCENT.go } : undefined}
                  right={(props) => (
                    <View style={styles.rowActions}>
                      <IconButton
                        {...props}
                        icon="download"
                        iconColor={theme.colors.primary}
                        onPress={() => onExport(s.session_id)}
                        accessibilityLabel="Export session as CSV"
                      />
                      <IconButton
                        {...props}
                        icon="trash-can-outline"
                        iconColor={ACCENT.stop}
                        disabled={active}
                        onPress={() => onDelete(s)}
                        accessibilityLabel="Delete session"
                      />
                    </View>
                  )}
                />
              </Card>
            );
          })
        )}

        {u.sent > 0 ? (
          <Button
            mode="outlined"
            icon="cloud-check-outline"
            textColor={ACCENT.stop}
            onPress={onClear}
            style={styles.clearBtn}
          >
            Clear {u.sent} synced points from phone
          </Button>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold' },
  scroll: { padding: 16, paddingBottom: 32, gap: 10 },
  card: { borderRadius: 16 },
  cardTitle: { fontFamily: 'Inter_600SemiBold' },
  rowActions: { flexDirection: 'row' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 4 },
  clearBtn: { marginTop: 8, borderRadius: 12, borderColor: '#F0C9C9' },
});

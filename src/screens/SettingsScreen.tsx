import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, HelperText, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { useUpload } from '../upload/UploadContext';
import { normalizeServerUrl } from '../upload/uploader';
import { ACCENT } from '../theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const u = useUpload();
  const [saved, setSaved] = useState(false);
  const resolvedUrl = normalizeServerUrl(u.serverUrl);

  const onSave = async () => {
    await u.save();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header mode="small" elevated>
        <Appbar.Content title="Settings" titleStyle={styles.title} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Server connection
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 14 }}>
            Paste the Cloudflare tunnel name and the shared token, then save. Choose Auto or Manual
            sync on the Track tab.
          </Text>

          <TextInput
            mode="outlined"
            label="Tunnel name"
            placeholder="accessing-pulled-cio-influences"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={u.serverUrl}
            onChangeText={u.setServerUrl}
            left={<TextInput.Icon icon="cloud-outline" />}
          />
          {resolvedUrl ? (
            <HelperText type="info" visible style={styles.mono}>
              {resolvedUrl}
            </HelperText>
          ) : null}

          <TextInput
            mode="outlined"
            label="Token"
            placeholder="shared secret"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={u.uploadToken}
            onChangeText={u.setUploadToken}
            left={<TextInput.Icon icon="key-outline" />}
            style={styles.tokenInput}
          />

          <Button
            mode="contained"
            icon={saved ? 'check' : 'content-save-outline'}
            onPress={onSave}
            buttonColor={saved ? ACCENT.go : theme.colors.primary}
            style={styles.saveBtn}
            contentStyle={{ height: 48 }}
          >
            {saved ? 'Saved' : 'Save'}
          </Button>
        </Surface>

        <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          The tunnel name changes each time you restart cloudflared on the laptop. Re-paste it here
          when you start a new session.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold' },
  scroll: { padding: 16, paddingBottom: 32, gap: 14 },
  card: { borderRadius: 20, padding: 18 },
  cardTitle: { marginBottom: 6, fontFamily: 'Inter_700Bold' },
  mono: { fontFamily: 'JetBrainsMono_400Regular', fontSize: 11 },
  tokenInput: { marginTop: 6 },
  saveBtn: { marginTop: 18, borderRadius: 12 },
  note: { textAlign: 'center', lineHeight: 17, paddingHorizontal: 8 },
});

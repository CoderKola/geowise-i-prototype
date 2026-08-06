import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  BottomNavigation,
  PaperProvider,
  MD3LightTheme,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  useFonts,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { TrackingProvider, useTracking } from './src/location/TrackingContext';
import { UploadProvider } from './src/upload/UploadContext';
import { theme } from './src/theme';
import TrackScreen from './src/screens/TrackScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const renderScene = BottomNavigation.SceneMap({
  track: TrackScreen,
  history: HistoryScreen,
  settings: SettingsScreen,
});

function RootTabs() {
  const t = useTracking();
  const [index, setIndex] = useState(0);
  const routes = [
    { key: 'track', title: 'Track', focusedIcon: 'crosshairs-gps', unfocusedIcon: 'crosshairs' },
    { key: 'history', title: 'History', focusedIcon: 'history', unfocusedIcon: 'history' },
    { key: 'settings', title: 'Settings', focusedIcon: 'cog', unfocusedIcon: 'cog-outline' },
  ];

  if (!t.ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <BottomNavigation
      navigationState={{ index, routes }}
      onIndexChange={setIndex}
      renderScene={renderScene}
      barStyle={{ backgroundColor: theme.colors.surface }}
      activeColor={theme.colors.primary}
    />
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <PaperProvider
      theme={theme}
      settings={{ icon: (props) => <MaterialCommunityIcons {...props} /> }}
    >
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <TrackingProvider>
          <UploadProvider>
            <RootTabs />
          </UploadProvider>
        </TrackingProvider>
      </SafeAreaProvider>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: MD3LightTheme.colors.background },
});

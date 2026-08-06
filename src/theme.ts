import { MD3LightTheme } from 'react-native-paper';

// Light Material 3, always. Brand: indigo primary, green = tracking/go, red = stop.
// Near-white surfaces, generous rounding (MD3 default is already rounded).
export const theme = {
  ...MD3LightTheme,
  roundness: 4, // MD3 multiplies this; cards land ~16px
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4F46E5', // indigo-600
    onPrimary: '#FFFFFF',
    primaryContainer: '#E5E7FB',
    onPrimaryContainer: '#1E1B4B',
    secondary: '#0D9488', // teal-600
    background: '#F6F7F9',
    surface: '#FFFFFF',
    surfaceVariant: '#EEF0F3',
    onSurface: '#0F172A',
    onSurfaceVariant: '#5A6675',
    outline: '#D5DAE1',
    outlineVariant: '#E7EAEF',
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level1: '#FFFFFF',
      level2: '#FFFFFF',
    },
  },
};

// Semantic accents used directly (outside the MD3 role system).
export const ACCENT = {
  go: '#16A34A', // green — tracking active / connected
  goSoft: '#EAF7EF',
  stop: '#DC2626', // red — stop / destructive
  stopSoft: '#FDECEC',
  amber: '#D97706', // pending / attention
};

export type AppTheme = typeof theme;

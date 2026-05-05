import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1A1D26',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    background: '#F8FAFC',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#EEF2FF',
    card: '#FFFFFF',
    border: '#E5E7EB',
    borderLight: '#F3F4F6',
    primary: '#4F46E5',
    primaryLight: '#EEF2FF',
    primaryDark: '#3730A3',
    success: '#059669',
    successLight: '#ECFDF5',
    error: '#DC2626',
    errorLight: '#FEF2F2',
    warning: '#D97706',
    warningLight: '#FFFBEB',
    overlay: 'rgba(0, 0, 0, 0.5)',
  },
  dark: {
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    textTertiary: '#6B7280',
    background: '#0F1117',
    backgroundElement: '#1A1D26',
    backgroundSelected: '#252836',
    card: '#1A1D26',
    border: '#2D3141',
    borderLight: '#252836',
    primary: '#818CF8',
    primaryLight: '#1E1B4B',
    primaryDark: '#A5B4FC',
    success: '#34D399',
    successLight: '#064E3B',
    error: '#F87171',
    errorLight: '#7F1D1D',
    warning: '#FBBF24',
    warningLight: '#78350F',
    overlay: 'rgba(0, 0, 0, 0.7)',
  },
} as const;

export type ThemeColor = keyof (typeof Colors)['light'] & keyof (typeof Colors)['dark'];

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const MaxContentWidth = 800;

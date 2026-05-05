import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppTheme = { [K in keyof (typeof Colors)['light']]: string };

export function useTheme(): AppTheme {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;
  return Colors[theme] as AppTheme;
}


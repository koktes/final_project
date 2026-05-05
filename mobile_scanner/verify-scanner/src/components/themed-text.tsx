import React from 'react';
import {
  Text as RNText,
  type TextProps as RNTextProps,
  StyleSheet,
} from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export interface TextProps extends RNTextProps {
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  color?: 'primary' | 'secondary' | 'tertiary' | 'error' | 'success' | 'white';
}

const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
};

export const Text: React.FC<TextProps> = ({
  weight = 'regular',
  size = 'md',
  color,
  style,
  ...props
}) => {
  const theme = useTheme();

  const colorMap: Record<NonNullable<TextProps['color']>, string> = {
    primary: theme.text,
    secondary: theme.textSecondary,
    tertiary: theme.textTertiary,
    error: theme.error,
    success: theme.success,
    white: '#FFFFFF',
  };

  return (
    <RNText
      style={[
        {
          fontWeight: fontWeights[weight],
          fontSize: fontSizes[size],
          color: colorMap[color ?? 'primary'],
        },
        style,
      ]}
      {...props}
    />
  );
};

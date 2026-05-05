import React from 'react';
import { View, type ViewProps } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export interface ThemedViewProps extends ViewProps {
  variant?: 'default' | 'card' | 'element';
}

export const ThemedView: React.FC<ThemedViewProps> = ({
  variant = 'default',
  style,
  ...props
}) => {
  const theme = useTheme();

  const bgMap = {
    default: theme.background,
    card: theme.card,
    element: theme.backgroundElement,
  };

  return <View style={[{ backgroundColor: bgMap[variant] }, style]} {...props} />;
};

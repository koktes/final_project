import { Stack } from 'expo-router';
import React from 'react';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="scan" />
      <Stack.Screen name="results" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}

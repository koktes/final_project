import React from 'react';
import {
  ScrollView, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { PROVIDERS } from '@/constants/api';
import { Radius, Spacing } from '@/constants/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const { logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text size="xl" style={{ color: theme.primary }}>←</Text>
        </TouchableOpacity>
        <Text weight="semibold" size="lg" style={{ color: theme.text, flex: 1, textAlign: 'center' }}>
          Settings
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Supported Providers */}
        <Text weight="semibold" size="md" style={{ color: theme.text, marginBottom: 12 }}>
          Supported Providers
        </Text>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
          {PROVIDERS.map((p, i) => (
            <View
              key={p.id}
              style={[
                styles.providerRow,
                i < PROVIDERS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderLight },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: p.color }]} />
              <Text size="sm" weight="medium" style={{ color: theme.text }}>{p.label}</Text>
            </View>
          ))}
        </View>

        {/* About */}
        <Text weight="semibold" size="md" style={{ color: theme.text, marginBottom: 12, marginTop: 24 }}>
          About
        </Text>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
          <View style={styles.aboutRow}>
            <Text size="sm" color="secondary">Version</Text>
            <Text size="sm" weight="medium" style={{ color: theme.text }}>1.0.0</Text>
          </View>
          <View style={[styles.aboutRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderLight }]}>
            <Text size="sm" color="secondary">Developer</Text>
            <Text size="sm" weight="medium" style={{ color: theme.text }}>Kokeb • Creofam</Text>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: theme.errorLight, borderColor: theme.error }]}
          onPress={handleLogout}
          activeOpacity={0.85}
        >
          <Text weight="semibold" style={{ color: theme.error }}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: 14, borderBottomWidth: 1 },
  scroll: { padding: Spacing.four, paddingBottom: 40 },
  card: { borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  providerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  logoutBtn: { marginTop: 32, height: 50, borderRadius: Radius.md, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
});

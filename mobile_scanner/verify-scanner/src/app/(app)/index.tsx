import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { PROVIDERS } from '@/constants/api';
import { Radius, Spacing } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <Text weight="bold" size="xl" style={{ color: theme.text, flex: 1, textAlign: 'center' }}>
          VerifyPay
        </Text>
        <TouchableOpacity onPress={() => router.push('/(app)/settings')}>
          <Ionicons name="settings-outline" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text weight="semibold" size="lg" style={{ color: theme.text, marginBottom: 12 }}>
          Universal Scan
        </Text>
        <View style={styles.grid}>
          <TouchableOpacity
            style={[styles.bigButton, { backgroundColor: theme.primaryLight, borderColor: theme.primary }]}
            onPress={() => router.push('/(app)/universal-scan')}
          >
            <Ionicons name="qr-code-outline" size={32} color={theme.primary} style={{ marginBottom: 8 }} />
            <Text weight="semibold" size="md" style={{ color: theme.primary }}>QR Scan</Text>
            <Text size="xs" style={{ color: theme.primaryDark, textAlign: 'center', marginTop: 4 }}>Auto-detect provider</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bigButton, { backgroundColor: theme.successLight, borderColor: theme.success }]}
            onPress={() => router.push('/(app)/universal-image')}
          >
            <Ionicons name="document-text-outline" size={32} color={theme.success} style={{ marginBottom: 8 }} />
            <Text weight="semibold" size="md" style={{ color: theme.success }}>Image OCR</Text>
            <Text size="xs" style={{ color: theme.successLight, textAlign: 'center', marginTop: 4, opacity: 0.8 }}>Upload full receipt</Text>
          </TouchableOpacity>
        </View>

        <Text weight="semibold" size="lg" style={{ color: theme.text, marginBottom: 12, marginTop: 24 }}>
          Scan by Provider
        </Text>
        <View style={styles.grid}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.providerButton, { backgroundColor: theme.card, borderColor: theme.borderLight }]}
              onPress={() => router.push(`/(app)/provider/${p.id}`)}
            >
              <Image source={p.image} style={{ width: 40, height: 40, borderRadius: 8, marginBottom: 8 }} resizeMode="contain" />
              <Text weight="medium" size="sm" style={{ color: theme.text, textAlign: 'center' }}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: 14, borderBottomWidth: 1 },
  scroll: { padding: Spacing.four, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  bigButton: { width: '48%', aspectRatio: 1, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.three, justifyContent: 'center', alignItems: 'center' },
  providerButton: { width: '48%', aspectRatio: 1.2, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.three, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  dot: { width: 16, height: 16, borderRadius: 8, marginBottom: 4 },
});

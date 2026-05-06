import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  TouchableOpacity, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/constants/theme';
import { verifyPayment, type VerifyResponse } from '@/services/api';

export default function ResultsScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ reference: string; suffix?: string; phoneNumber?: string }>();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    if (!params.reference || !token) return;
    setLoading(true); setError(null);
    try {
      const data = await verifyPayment(
        { reference: params.reference, suffix: params.suffix, phoneNumber: params.phoneNumber },
        token,
      );
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [params.reference, params.suffix, params.phoneNumber, token]);

  useEffect(() => { verify(); }, [verify]);

  const renderRow = (label: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <View style={[styles.row, { borderBottomColor: theme.borderLight }]}>
        <Text size="sm" color="secondary" style={styles.label}>{label}</Text>
        <Text size="sm" weight="medium" style={[styles.value, { color: theme.text }]}>
          {String(value)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text size="xl" style={{ color: theme.primary }}>←</Text>
        </TouchableOpacity>
        <Text weight="semibold" size="lg" style={{ color: theme.text, flex: 1, textAlign: 'center' }}>
          Verification Result
        </Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text size="md" color="secondary" style={{ marginTop: 16 }}>Verifying payment…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <View style={[styles.statusBadge, { backgroundColor: theme.errorLight }]}>
            <Text size="3xl">❌</Text>
          </View>
          <Text weight="bold" size="xl" style={{ color: theme.error, marginTop: 16 }}>
            Verification Failed
          </Text>
          <Text size="sm" color="secondary" style={{ marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>
            {error}
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: theme.primary }]} onPress={verify}>
            <Text weight="semibold" style={{ color: '#FFF' }}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.scanBtn, { borderColor: theme.border }]} onPress={() => router.back()}>
            <Text weight="medium" color="secondary">Scan Again</Text>
          </TouchableOpacity>
        </View>
      ) : result ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Status */}
          <View style={styles.statusSection}>
            <View style={[styles.statusBadge, { backgroundColor: result.success ? theme.successLight : theme.errorLight }]}>
              <Text size="3xl">{result.success ? '✅' : '❌'}</Text>
            </View>
            <Text weight="bold" size="xl" style={{ color: result.success ? theme.success : theme.error, marginTop: 12 }}>
              {result.success ? 'Payment Verified' : 'Not Verified'}
            </Text>
          </View>

          {/* Details Card */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
            <Text weight="semibold" size="md" style={{ color: theme.text, marginBottom: 12 }}>
              Transaction Details
            </Text>
            {renderRow('Reference', params.reference)}
            {renderRow('Provider', result.provider)}
            {renderRow('Status', result.status)}
            {renderRow('Payer', result.payerName || result.senderName)}
            {renderRow('Payer Account', result.payerAccount || result.senderAccountNumber)}
            {renderRow('Receiver', result.receiverName || result.creditedPartyName)}
            {renderRow('Receiver Account', result.receiverAccount)}
            {renderRow('Amount', result.amount ?? result.transactionAmount ?? result.settledAmount)}
            {renderRow('Total', result.total ?? result.totalPaidAmount)}
            {renderRow('Service Fee', result.serviceFees ?? result.serviceCharge)}
            {renderRow('VAT', result.vat)}
            {renderRow('Date', result.paymentDate ?? result.transactionDate)}
            {renderRow('Receipt #', result.receiptNumber ?? result.transactionReference)}
            {renderRow('Description', result.description ?? result.narrative)}
            {renderRow('Channel', result.transactionChannel)}
            {renderRow('Service Type', result.serviceType)}
            {renderRow('Bank', result.bankName)}
            {renderRow('Phone', result.phoneNo ?? result.telebirrNumber)}
          </View>

          {/* Actions */}
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: theme.primary }]} onPress={() => router.back()}>
            <Text weight="semibold" size="lg" style={{ color: '#FFF' }}>Scan Another</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: 14, borderBottomWidth: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  statusSection: { alignItems: 'center', paddingVertical: Spacing.four },
  statusBadge: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: Spacing.four, paddingBottom: 40 },
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.four, marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1 },
  value: { flex: 1.5, textAlign: 'right' },
  retryBtn: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 14, borderRadius: Radius.md },
  scanBtn: { marginTop: 12, paddingHorizontal: 32, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1 },
  primaryBtn: { height: 52, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center' },
});

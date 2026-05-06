import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  TouchableOpacity, View, Platform, Image
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/constants/theme';
import { verifyPayment, verifyImage, type VerifyResponse } from '@/services/api';
import { PROVIDERS } from '@/constants/api';
import { Ionicons } from '@expo/vector-icons';

export default function ResultsScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ reference: string; suffix?: string; phoneNumber?: string; providerId?: string; imageUri?: string }>();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null); // Use any to capture all possible bank response fields
  const [error, setError] = useState<string | null>(null);

  const matchedProviderId = result?.provider || result?.bank || params.providerId;
  const matchedProvider = matchedProviderId 
    ? PROVIDERS.find(p => p.id === matchedProviderId?.toLowerCase() || p.id === matchedProviderId?.toLowerCase().replace('_', ''))
    : null;

  const verify = useCallback(async () => {
    if (!params.reference || !token) return;
    setLoading(true); setError(null);
    try {
      let data;
      if (params.imageUri) {
         data = await verifyImage(
           params.imageUri,
           token,
           { 
             reference: params.reference, 
             suffix: params.suffix || '', 
             phoneNumber: params.phoneNumber || '',
             providerId: params.providerId || ''
           },
           true // Set autoVerify=true to hit the backend verification and history logging
         );
      } else {
         data = await verifyPayment(
           { reference: params.reference, suffix: params.suffix, phoneNumber: params.phoneNumber },
           token,
         );
      }
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [params.reference, params.suffix, params.phoneNumber, token]);

  useEffect(() => { verify(); }, [verify]);

  const renderRow = (label: string, value: string | number | undefined | null, isMonospace = false) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <View style={[styles.row, { borderBottomColor: theme.borderLight }]}>
        <Text size="sm" color="secondary" style={styles.label}>{label}</Text>
        <Text 
          size="sm" 
          weight="medium" 
          style={[
            styles.value, 
            { color: theme.text },
            isMonospace && { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }
          ]}
        >
          {String(value)}
        </Text>
      </View>
    );
  };

  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getAmount = () => {
    if (!result) return null;
    return result.amount ?? result.transactionAmount ?? result.settledAmount ?? result.total ?? result.totalPaidAmount;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.primary} />
        </TouchableOpacity>
        <Text weight="semibold" size="lg" style={{ color: theme.text, flex: 1, textAlign: 'center' }}>
          Verification Detail
        </Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text size="md" color="secondary" style={{ marginTop: 16 }}>Verifying with bank records…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <View style={[styles.statusBadge, { backgroundColor: theme.errorLight }]}>
            <Ionicons name="close-circle-outline" size={48} color={theme.error} />
          </View>
          <Text weight="bold" size="xl" style={{ color: theme.error, marginTop: 16 }}>
            Verification Failed
          </Text>
          <Text size="sm" color="secondary" style={{ marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>
            {error}
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: theme.primary }]} onPress={verify}>
            <Text weight="semibold" style={{ color: '#FFF' }}>Retry Verification</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.scanAgainBtn, { borderColor: theme.border }]} onPress={() => router.back()}>
            <Text weight="medium" color="secondary">Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : result ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Status Banner */}
          <View style={[styles.statusBanner, { backgroundColor: result.success ? theme.successLight : theme.errorLight }]}>
            <View style={[styles.iconCircle, { backgroundColor: result.success ? theme.success : theme.error }]}>
              <Ionicons name={result.success ? "checkmark" : "close"} size={20} color="#FFF" />
            </View>
            <View style={styles.statusTextContainer}>
              <Text weight="bold" size="lg" style={{ color: result.success ? theme.success : theme.error }}>
                {result.success ? 'Verification Successful' : 'Verification Failed'}
              </Text>
            </View>
          </View>

          {/* Provider Logo */}
          {matchedProvider ? (
            <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
               <View style={{ backgroundColor: theme.backgroundElement, padding: 16, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2, borderWidth: 1, borderColor: theme.borderLight }}>
                  <Image source={matchedProvider.image} style={{ width: 72, height: 72, borderRadius: 16 }} resizeMode="contain" />
               </View>
               <Text weight="bold" size="lg" style={{ color: theme.text, marginTop: 16 }}>{matchedProvider.label}</Text>
            </View>
          ) : matchedProviderId ? (
            <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
               <View style={{ backgroundColor: theme.backgroundElement, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.borderLight }}>
                  <Text weight="bold" size="sm" style={{ color: theme.primary }}>{matchedProviderId.toUpperCase()}</Text>
               </View>
            </View>
          ) : null}

          {/* Success Message */}
          {result.success && (
            <View style={[styles.messageBox, { backgroundColor: theme.successLight + '40' }]}>
               <Text size="sm" style={{ color: theme.success, textAlign: 'center' }}>
                Receipt correctly verified against the bank records.
              </Text>
            </View>
          )}

          {/* Amount Highlight */}
          {getAmount() !== null && (
            <View style={styles.amountHighlight}>
              <Text size="sm" color="secondary" style={{ marginBottom: 4 }}>Total Amount</Text>
              <View style={styles.amountRow}>
                <Text weight="bold" style={[styles.currency, { color: theme.primary }]}>ETB</Text>
                <Text weight="bold" style={[styles.amountValue, { color: theme.text }]}>
                  {Number(getAmount()).toLocaleString()}
                </Text>
              </View>
            </View>
          )}

          {/* Date Highlight */}
          {(result.paymentDate ?? result.transactionDate ?? result.date) && (
            <View style={[styles.dateHighlight, { backgroundColor: theme.backgroundElement }]}>
              <Text size="xs" color="secondary" weight="medium">TRANSACTION DATE</Text>
              <Text weight="semibold" size="md" style={{ color: theme.text, marginTop: 2 }}>
                {formatDate(result.paymentDate ?? result.transactionDate ?? result.date)}
              </Text>
            </View>
          )}

          {/* Details Card */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
            {renderRow('Reference', params.reference ?? result.referenceNumber ?? result.transactionReference ?? result.reference, true)}
            {renderRow('Source', (result.source as string) || 'api-verify')}
            {renderRow('Payer', result.payer ?? result.payerName ?? result.senderName)}
            {renderRow('Payer Account', result.payerAccount ?? result.senderAccountNumber, true)}
            {renderRow('Receiver', result.receiver ?? result.receiverName ?? result.creditedPartyName)}
            {renderRow('Receiver Account', result.receiverAccount, true)}
            {renderRow('Reason', result.reason ?? result.description ?? result.narrative)}
            {renderRow('Channel', result.transactionChannel)}
            {renderRow('Service Type', result.serviceType)}
            {renderRow('Service Fee', result.serviceFees ?? result.serviceCharge)}
            {renderRow('VAT', result.vat)}
          </View>

          {/* Actions */}
          <View style={styles.actionContainer}>
            <TouchableOpacity 
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]} 
              onPress={() => router.push('/(app)')}
            >
              <Text weight="semibold" size="lg" style={{ color: '#FFF' }}>Done</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.secondaryBtn, { borderColor: theme.border }]} 
              onPress={() => router.back()}
            >
              <Text weight="medium" color="secondary">Scan Another</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: 14, borderBottomWidth: 1 },
  backButton: { paddingRight: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  scroll: { paddingBottom: 40 },
  statusBanner: { flexDirection: 'row', alignItems: 'center', padding: Spacing.four, paddingVertical: 20 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  statusTextContainer: { flex: 1 },
  providerTag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  messageBox: { padding: 12, marginHorizontal: Spacing.four, borderRadius: Radius.sm, marginBottom: 20 },
  amountHighlight: { alignItems: 'center', paddingVertical: 10, marginBottom: 20 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline' },
  currency: { fontSize: 18, marginRight: 4 },
  amountValue: { fontSize: 36, letterSpacing: -1 },
  dateHighlight: { marginHorizontal: Spacing.four, padding: 16, borderRadius: Radius.md, marginBottom: 20, alignItems: 'center' },
  card: { marginHorizontal: Spacing.four, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.four, marginBottom: 30 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontSize: 13 },
  value: { flex: 2, textAlign: 'right', fontSize: 14 },
  actionContainer: { paddingHorizontal: Spacing.four, gap: 12 },
  primaryBtn: { height: 56, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  secondaryBtn: { height: 52, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  statusBadge: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  retryBtn: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 14, borderRadius: Radius.md },
  scanAgainBtn: { marginTop: 12, paddingHorizontal: 32, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1 },
});

import React, { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, TextInput, TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';
import { Scanner } from '@/components/scanner';
import { Text } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/constants/theme';

export default function ScanScreen() {
  const theme = useTheme();
  const [showManual, setShowManual] = useState(false);
  const [reference, setReference] = useState('');
  const [suffix, setSuffix] = useState('');
  const [phone, setPhone] = useState('');

  const handleScanned = ({ data }: { data: string }) => {
    router.push({ pathname: '/(app)/results', params: { reference: data } });
  };

  const handleManualSubmit = () => {
    const ref = reference.trim();
    if (!ref) { Alert.alert('Error', 'Enter a reference number'); return; }
    const params: Record<string, string> = { reference: ref };
    if (suffix.trim()) params.suffix = suffix.trim();
    if (phone.trim()) params.phoneNumber = phone.trim();
    setShowManual(false); setReference(''); setSuffix(''); setPhone('');
    router.push({ pathname: '/(app)/results', params });
  };

  const inp = (bg: string, bc: string, tc: string) => [
    styles.input, { backgroundColor: bg, borderColor: bc, color: tc }
  ];

  return (
    <>
      <Scanner
        title="Scan Receipt"
        subtitle="Point camera at payment QR code"
        instruction="Align the QR code or barcode within the frame"
        onScanned={handleScanned}
        manualActionLabel="Enter Manually"
        onManualAction={() => setShowManual(true)}
        acceptedTypes={['qr', 'code128', 'code39', 'ean13', 'ean8']}
      />
      <Modal visible={showManual} animationType="slide" transparent onRequestClose={() => setShowManual(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowManual(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            <Text weight="bold" size="xl" style={{ color: theme.text, marginBottom: 6 }}>Manual Verification</Text>
            <Text size="sm" color="secondary" style={{ marginBottom: 20 }}>
              Enter the transaction reference. Additional fields depend on the provider.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6 }}>Reference *</Text>
              <TextInput style={inp(theme.backgroundElement, theme.border, theme.text)} placeholder="e.g. FT2513001V2G" placeholderTextColor={theme.textTertiary} value={reference} onChangeText={setReference} autoCapitalize="characters" autoCorrect={false} />
              <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6, marginTop: 16 }}>Suffix (CBE/BOA)</Text>
              <TextInput style={inp(theme.backgroundElement, theme.border, theme.text)} placeholder="e.g. 39003377" placeholderTextColor={theme.textTertiary} value={suffix} onChangeText={setSuffix} keyboardType="number-pad" />
              <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6, marginTop: 16 }}>Phone (CBE Birr)</Text>
              <TextInput style={inp(theme.backgroundElement, theme.border, theme.text)} placeholder="e.g. 251912345678" placeholderTextColor={theme.textTertiary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <View style={[styles.hint, { backgroundColor: theme.primaryLight }]}>
                <Text weight="semibold" size="xs" style={{ color: theme.primary, marginBottom: 4 }}>Detection Rules</Text>
                <Text size="xs" style={{ color: theme.textSecondary, lineHeight: 16 }}>
                  {'• CBE: 12 chars "FT…" + 8-digit suffix\n• BOA: 12 chars "FT…" + 5-digit suffix\n• Dashen: 16 chars\n• CBE Birr: 10 chars + phone\n• Telebirr: 10 chars only'}
                </Text>
              </View>
              <TouchableOpacity style={[styles.btn, { backgroundColor: theme.primary }]} onPress={handleManualSubmit} activeOpacity={0.85}>
                <Text weight="semibold" size="lg" style={{ color: '#FFF' }}>Verify Payment</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={() => setShowManual(false)}>
                <Text weight="medium" color="secondary">Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: Spacing.four, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 40 : 24, maxHeight: '80%' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  input: { height: 50, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 16, fontSize: 15 },
  hint: { marginTop: 20, padding: 14, borderRadius: Radius.md },
  btn: { height: 52, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  cancelBtn: { height: 48, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', marginTop: 12, borderWidth: 1 },
});

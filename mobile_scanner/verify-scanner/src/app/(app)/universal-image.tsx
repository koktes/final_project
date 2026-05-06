import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, TextInput, ScrollView } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/context/auth';
import { PROVIDERS, ProviderInfo } from '@/constants/api';
import { Radius, Spacing } from '@/constants/theme';
import { verifyImage } from '@/services/api';
import { Ionicons } from '@expo/vector-icons';

export default function UniversalImageScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [showMissingFields, setShowMissingFields] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [detectedProvider, setDetectedProvider] = useState<ProviderInfo | null>(null);

  const executeVerify = (params: Record<string, string>) => {
    setShowMissingFields(false);
    setFormData({});
    setDetectedProvider(null);
    router.push({ pathname: '/(app)/results', params });
  };

  const handleMissingFieldsSubmit = () => {
    if (!detectedProvider) return;
    for (const field of detectedProvider.fields) {
      if (!formData[field.name]?.trim()) {
        Alert.alert('Error', `Please enter ${field.label}`);
        return;
      }
    }
    executeVerify({ ...formData, providerId: detectedProvider.id });
  };

  const processImage = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets[0]?.uri) return;
    
    setIsProcessing(true);
    try {
      const originalUri = result.assets[0].uri;

      // Copy the file so we have a fresh copy for the second (autoVerify) request.
      // React Native consumes the file stream on the first network upload.
      const ext = originalUri.split('.').pop() || 'jpg';
      const copyUri = FileSystemLegacy.cacheDirectory + `receipt_copy_${Date.now()}.${ext}`;
      await FileSystemLegacy.copyAsync({ from: originalUri, to: copyUri });

      const data = await verifyImage(originalUri, token!, { autoVerify: 'false' });
      
      const extractedRef = data.reference || data.receiptNumber || data.orderId || '';
      const bankId = data.bank?.toLowerCase() || '';
      
      if (!extractedRef && !bankId) {
        Alert.alert('Error', 'Could not detect a valid receipt from the image.');
        return;
      }

      // Pass the COPY uri to the results screen so it has a fresh, unconsumed file
      const newFormData: Record<string, string> = { reference: extractedRef, imageUri: copyUri };
      if (data.extractedPhoneNumber) {
         newFormData.phoneNumber = data.extractedPhoneNumber;
      }

      const provider = PROVIDERS.find(p => p.id === bankId || p.id === bankId.replace('_', ''));
      
      if (provider) {
        const missing = provider.fields.filter(f => !newFormData[f.name]);
        if (missing.length > 0) {
          setDetectedProvider(provider);
          setFormData(newFormData);
          setShowMissingFields(true);
        } else {
          executeVerify({ ...newFormData, providerId: provider.id });
        }
      } else {
        // Just forward the reference to universal router
        executeVerify(newFormData);
      }

    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    processImage(result);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Denied', 'Camera access is required to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    processImage(result);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.primary} />
        </TouchableOpacity>
        <Text weight="bold" size="xl" style={{ color: theme.text, flex: 1, textAlign: 'center' }}>
          Image OCR
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.content}>
        <Text size="md" color="secondary" style={{ textAlign: 'center', marginBottom: 40 }}>
          Upload a payment receipt image to automatically extract the details.
        </Text>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.primaryLight, borderColor: theme.primary }]} onPress={takePhoto}>
          <Ionicons name="camera-outline" size={40} color={theme.primary} style={{ marginBottom: 12 }} />
          <Text weight="bold" size="lg" style={{ color: theme.primary }}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.card, borderColor: theme.borderLight, marginTop: 24 }]} onPress={pickImage}>
          <Ionicons name="image-outline" size={40} color={theme.textSecondary} style={{ marginBottom: 12 }} />
          <Text weight="bold" size="lg" style={{ color: theme.text }}>Upload from Gallery</Text>
        </TouchableOpacity>
      </View>

      {/* Processing overlay */}
      {isProcessing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text weight="semibold" style={{ color: '#FFF', marginTop: 16 }}>Scanning Image...</Text>
        </View>
      )}

      {/* Missing Fields Modal */}
      <Modal visible={showMissingFields} animationType="slide" transparent onRequestClose={() => setShowMissingFields(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowMissingFields(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            <Text weight="bold" size="xl" style={{ color: theme.text, marginBottom: 6 }}>Additional Info Needed</Text>
            <Text size="sm" color="secondary" style={{ marginBottom: 10 }}>We detected a {detectedProvider?.label} receipt ({formData.reference}), but need a bit more info.</Text>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              {detectedProvider?.fields.filter(f => f.name !== 'reference').map(field => (
                <View key={field.name}>
                  <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6, marginTop: 16 }}>{field.label}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                    placeholder={field.placeholder}
                    placeholderTextColor={theme.textTertiary}
                    value={formData[field.name] || ''}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, [field.name]: text }))}
                    keyboardType={field.keyboardType || 'default'}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              ))}
              <TouchableOpacity style={[styles.btn, { backgroundColor: theme.primary }]} onPress={handleMissingFieldsSubmit} activeOpacity={0.85}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text weight="semibold" size="lg" style={{ color: '#FFF' }}>Verify Payment</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn: { paddingRight: 16 },
  content: { flex: 1, padding: Spacing.four, justifyContent: 'center' },
  actionBtn: { width: '100%', paddingVertical: 40, borderRadius: Radius.xl, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: Spacing.four, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 40 : 24, maxHeight: '80%' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  input: { height: 50, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 16, fontSize: 15 },
  btn: { height: 52, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', marginTop: 24, marginBottom: 12 },
});

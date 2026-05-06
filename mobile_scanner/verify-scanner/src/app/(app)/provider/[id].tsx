import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, TextInput, Alert, Platform, KeyboardAvoidingView, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/context/auth';
import { PROVIDERS } from '@/constants/api';
import { Radius, Spacing } from '@/constants/theme';
import { verifyImage } from '@/services/api';
import { Scanner } from '@/components/scanner';
import { Ionicons } from '@expo/vector-icons';

export default function ProviderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { token } = useAuth();
  
  const provider = PROVIDERS.find(p => p.id === id);
  
  const [showManual, setShowManual] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showMissingFields, setShowMissingFields] = useState(false);
  
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  
  if (!provider) return <Text>Provider not found</Text>;

  const handleFieldChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const executeVerify = (params: Record<string, string>) => {
    setShowManual(false);
    setShowScanner(false);
    setShowMissingFields(false);
    setFormData({});
    router.push({ pathname: '/(app)/results', params });
  };

  const handleManualSubmit = () => {
    // Validate all required fields
    for (const field of provider.fields) {
      if (!formData[field.name]?.trim()) {
        Alert.alert('Error', `Please enter ${field.label}`);
        return;
      }
    }
    executeVerify({ ...formData, providerId: provider.id });
  };

  const handleMissingFieldsSubmit = () => {
    for (const field of provider.fields) {
      if (!formData[field.name]?.trim()) {
        Alert.alert('Error', `Please enter ${field.label}`);
        return;
      }
    }
    executeVerify({ ...formData, providerId: provider.id });
  };

  const handleScanned = ({ data }: { data: string }) => {
    setShowScanner(false);
    const newFormData: Record<string, string> = { ...formData, reference: data };
    
    // Check if other fields are needed
    const missing = provider.fields.filter(f => f.name !== 'reference' && !newFormData[f.name]);
    if (missing.length > 0) {
      setFormData(newFormData);
      setShowMissingFields(true);
    } else {
      executeVerify({ ...newFormData, providerId: provider.id });
    }
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

      // Pass the provider id as a hint
      const data = await verifyImage(originalUri, token!, { autoVerify: 'false', expectedProvider: provider.id });
      
      const extractedRef = data.reference || data.receiptNumber || data.orderId || '';
      
      if (!extractedRef) {
        Alert.alert('Error', 'Could not detect a valid reference number from the image.');
        return;
      }

      // Pass the COPY uri to the results screen so it has a fresh, unconsumed file
      const newFormData: Record<string, string> = { ...formData, reference: extractedRef, imageUri: copyUri };
      if (data.extractedPhoneNumber) {
         newFormData.phoneNumber = data.extractedPhoneNumber;
      }

      const missing = provider.fields.filter(f => !newFormData[f.name]);
      if (missing.length > 0) {
        setFormData(newFormData);
        setShowMissingFields(true);
      } else {
        executeVerify({ ...newFormData, providerId: provider.id });
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

  const renderFieldsForm = (onSubmit: () => void, fieldsToRender: typeof provider.fields) => (
    <ScrollView showsVerticalScrollIndicator={false}>
      {fieldsToRender.map(field => (
        <View key={field.name}>
          <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6, marginTop: 16 }}>{field.label}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
            placeholder={field.placeholder}
            placeholderTextColor={theme.textTertiary}
            value={formData[field.name] || ''}
            onChangeText={(text) => handleFieldChange(field.name, text)}
            keyboardType={field.keyboardType || 'default'}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
      ))}
      <TouchableOpacity style={[styles.btn, { backgroundColor: theme.primary }]} onPress={onSubmit} activeOpacity={0.85}>
        <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
        <Text weight="semibold" size="lg" style={{ color: '#FFF' }}>Verify Payment</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.primary} />
        </TouchableOpacity>
        <Text weight="bold" size="xl" style={{ color: theme.text, flex: 1, textAlign: 'center' }}>
          {provider.label}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.iconContainer}>
          <Image source={provider.image} style={{ width: 80, height: 80, borderRadius: 16 }} resizeMode="contain" />
          <Text size="md" color="secondary" style={{ textAlign: 'center', marginTop: 16 }}>
            Choose how to scan the receipt
          </Text>
        </View>

        <View style={styles.grid}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.card, borderColor: theme.borderLight }]} onPress={() => setShowScanner(true)}>
            <Ionicons name="qr-code-outline" size={32} color={theme.primary} />
            <Text weight="semibold" style={{ color: theme.text, marginTop: 8 }}>Scan QR</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.card, borderColor: theme.borderLight }]} onPress={takePhoto}>
            <Ionicons name="camera-outline" size={32} color={theme.primary} />
            <Text weight="semibold" style={{ color: theme.text, marginTop: 8 }}>Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.card, borderColor: theme.borderLight }]} onPress={pickImage}>
            <Ionicons name="image-outline" size={32} color={theme.primary} />
            <Text weight="semibold" style={{ color: theme.text, marginTop: 8 }}>Upload Image</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.card, borderColor: theme.borderLight }]} onPress={() => setShowManual(true)}>
            <Ionicons name="create-outline" size={32} color={theme.primary} />
            <Text weight="semibold" style={{ color: theme.text, marginTop: 8 }}>Manual Entry</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Processing overlay */}
      {isProcessing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text weight="semibold" style={{ color: '#FFF', marginTop: 16 }}>Processing Image...</Text>
        </View>
      )}

      {/* Manual Entry Modal */}
      <Modal visible={showManual} animationType="slide" transparent onRequestClose={() => setShowManual(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowManual(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            <Text weight="bold" size="xl" style={{ color: theme.text, marginBottom: 6 }}>Manual Verification</Text>
            {renderFieldsForm(handleManualSubmit, provider.fields)}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Missing Fields Modal */}
      <Modal visible={showMissingFields} animationType="slide" transparent onRequestClose={() => setShowMissingFields(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowMissingFields(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.borderLight }]}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            <Text weight="bold" size="xl" style={{ color: theme.text, marginBottom: 6 }}>Additional Info Needed</Text>
            <Text size="sm" color="secondary" style={{ marginBottom: 10 }}>We detected the reference ({formData.reference}), but need a bit more info.</Text>
            {renderFieldsForm(handleMissingFieldsSubmit, provider.fields.filter(f => f.name !== 'reference'))}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* QR Scanner Modal */}
      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.scannerHeader}>
             <TouchableOpacity onPress={() => setShowScanner(false)} hitSlop={12}>
                <Text size="xl" style={{ color: '#FFF' }}>✕ Close</Text>
             </TouchableOpacity>
          </View>
          <Scanner
            title={`Scan ${provider.label} QR`}
            instruction="Align the QR code within the frame"
            onScanned={handleScanned}
            acceptedTypes={['qr', 'code128', 'code39']}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn: { paddingRight: 16 },
  scroll: { padding: Spacing.four, paddingBottom: 40 },
  iconContainer: { alignItems: 'center', marginVertical: 32 },
  logoPlaceholder: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  actionBtn: { width: '48%', aspectRatio: 1.0, borderRadius: Radius.lg, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: Spacing.four, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 40 : 24, maxHeight: '80%' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  input: { height: 50, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 16, fontSize: 15 },
  btn: { height: 52, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  scannerHeader: { padding: 16, backgroundColor: '#000', flexDirection: 'row', justifyContent: 'flex-end' }
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';

interface ScannerProps {
  title: string;
  subtitle?: string;
  instruction: string;
  onScanned: (params: { data: string; type?: string }) => void;
  validateScan?: (data: string, type?: string) => string | null;
  manualActionLabel?: string;
  onManualAction?: () => void;
  acceptedTypes?: string[];
}

export const Scanner: React.FC<ScannerProps> = ({
  title,
  subtitle,
  instruction,
  onScanned,
  validateScan,
  manualActionLabel,
  onManualAction,
  acceptedTypes,
}) => {
  const theme = useTheme();

  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = permission?.granted ?? null;
  const [flashEnabled, setFlashEnabled] = useState<boolean>(false);

  const hasCompletedRef = useRef<boolean>(false);
  const lastValidationAtRef = useRef<number>(0);
  const scanLineOffset = useRef(new Animated.Value(0)).current;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: '#000000',
        },
        cameraContainer: {
          flex: 1,
          backgroundColor: '#000000',
        },
        camera: {
          flex: 1,
        },
        overlay: {
          ...StyleSheet.absoluteFillObject,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
        },
        topBar: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 12,
          backgroundColor: 'rgba(0,0,0,0.35)',
        },
        topBarTitle: {
          color: '#FFFFFF',
          fontSize: 18,
          fontWeight: '600',
        },
        flashButton: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: 'rgba(255,255,255,0.15)',
          justifyContent: 'center',
          alignItems: 'center',
        },
        flashText: {
          fontSize: 20,
        },
        title: {
          color: '#FFFFFF',
          textAlign: 'center',
          fontSize: 24,
          fontWeight: '700',
          marginBottom: 10,
        },
        subtitle: {
          color: 'rgba(255,255,255,0.9)',
          textAlign: 'center',
          fontSize: 16,
          marginBottom: 24,
        },
        frame: {
          width: 260,
          height: 260,
          borderRadius: 24,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.55)',
          backgroundColor: 'rgba(255,255,255,0.08)',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        },
        scanLine: {
          position: 'absolute',
          left: 20,
          right: 20,
          height: 2,
          backgroundColor: theme.primary,
          opacity: 0.9,
        },
        instruction: {
          marginTop: 18,
          color: 'rgba(255,255,255,0.9)',
          textAlign: 'center',
          fontSize: 14,
          lineHeight: 20,
        },
        manualButton: {
          marginTop: 26,
          paddingHorizontal: 22,
          paddingVertical: 14,
          borderRadius: 12,
          backgroundColor: theme.primary,
          minWidth: 240,
          alignItems: 'center',
        },
        manualButtonText: {
          color: '#FFFFFF',
          fontSize: 16,
          fontWeight: '600',
        },
        permissionCard: {
          paddingHorizontal: 18,
          paddingVertical: 24,
          borderRadius: 16,
          backgroundColor: theme.card,
          borderWidth: 1,
          borderColor: theme.border,
          width: '100%',
          maxWidth: 420,
        },
        permissionTitle: {
          fontSize: 18,
          color: theme.text,
          marginBottom: 8,
          textAlign: 'center',
          fontWeight: '600',
        },
        permissionMessage: {
          fontSize: 14,
          color: theme.textSecondary,
          textAlign: 'center',
          marginBottom: 18,
          lineHeight: 20,
        },
        permissionButton: {
          alignSelf: 'center',
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 12,
          backgroundColor: theme.primary,
        },
        permissionButtonText: {
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: '600',
        },
        cornerTL: {
          position: 'absolute',
          top: -1,
          left: -1,
          width: 32,
          height: 32,
          borderTopWidth: 3,
          borderLeftWidth: 3,
          borderColor: theme.primary,
          borderTopLeftRadius: 24,
        },
        cornerTR: {
          position: 'absolute',
          top: -1,
          right: -1,
          width: 32,
          height: 32,
          borderTopWidth: 3,
          borderRightWidth: 3,
          borderColor: theme.primary,
          borderTopRightRadius: 24,
        },
        cornerBL: {
          position: 'absolute',
          bottom: -1,
          left: -1,
          width: 32,
          height: 32,
          borderBottomWidth: 3,
          borderLeftWidth: 3,
          borderColor: theme.primary,
          borderBottomLeftRadius: 24,
        },
        cornerBR: {
          position: 'absolute',
          bottom: -1,
          right: -1,
          width: 32,
          height: 32,
          borderBottomWidth: 3,
          borderRightWidth: 3,
          borderColor: theme.primary,
          borderBottomRightRadius: 24,
        },
      }),
    [theme]
  );

  const acceptedTypesNormalized = useMemo<string[]>(
    () => (acceptedTypes || []).map((type) => type.toLowerCase()),
    [acceptedTypes]
  );

  const barcodeTypes = useMemo<BarcodeType[] | undefined>(
    () =>
      acceptedTypesNormalized.length > 0
        ? (acceptedTypesNormalized as BarcodeType[])
        : undefined,
    [acceptedTypesNormalized]
  );

  const handleBarcodes = useCallback(
    (barcode: BarcodeScanningResult): void => {
      if (hasCompletedRef.current) return;

      const data = barcode.data?.trim();
      if (!data) return;

      if (acceptedTypesNormalized.length > 0) {
        const normalizedType = barcode.type?.toLowerCase?.() ?? '';
        if (!acceptedTypesNormalized.includes(normalizedType)) {
          return;
        }
      }

      const validationMessage = validateScan?.(data, barcode.type);
      if (validationMessage) {
        const now = Date.now();
        if (now - lastValidationAtRef.current > 1500) {
          lastValidationAtRef.current = now;
          // Could show a toast here
          console.warn('Scan validation:', validationMessage);
        }
        return;
      }

      hasCompletedRef.current = true;
      onScanned({ data, type: barcode.type });
    },
    [acceptedTypesNormalized, onScanned, validateScan]
  );

  const toggleFlash = useCallback((): void => {
    setFlashEnabled((prev) => !prev);
  }, []);

  useFocusEffect(
    useCallback(() => {
      hasCompletedRef.current = false;

      if (hasPermission !== true) {
        void requestPermission();
      }

      return undefined;
    }, [hasPermission, requestPermission])
  );

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineOffset, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineOffset, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [scanLineOffset]);

  const scanLineTranslateY = scanLineOffset.interpolate({
    inputRange: [0, 1],
    outputRange: [-110, 110],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          enableTorch={flashEnabled}
          onBarcodeScanned={hasPermission ? handleBarcodes : undefined}
          barcodeScannerSettings={barcodeTypes ? { barcodeTypes } : undefined}
        />

        <View style={styles.overlay} pointerEvents="box-none">
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={{ width: 44 }} />
            <Text weight="semibold" style={styles.topBarTitle}>
              {title}
            </Text>
            <TouchableOpacity
              onPress={toggleFlash}
              style={styles.flashButton}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={flashEnabled ? 'Turn flash off' : 'Turn flash on'}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name={flashEnabled ? "flash" : "flash-off"} size={22} color="#FFF" />
            </TouchableOpacity>
          </View>

          {hasPermission === null ? (
            <ActivityIndicator size="large" color={theme.primary} />
          ) : hasPermission === false ? (
            <View style={styles.permissionCard}>
              <Text weight="semibold" style={styles.permissionTitle}>
                Camera Permission Required
              </Text>
              <Text style={styles.permissionMessage}>
                We need access to your camera to scan payment QR codes and barcodes for verification.
              </Text>
              <TouchableOpacity
                onPress={requestPermission}
                style={styles.permissionButton}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Grant camera permission"
                activeOpacity={0.85}
              >
                <Text weight="semibold" style={styles.permissionButtonText}>
                  Grant Permission
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

              <View style={styles.frame}>
                {/* Corner accents */}
                <View style={styles.cornerTL} />
                <View style={styles.cornerTR} />
                <View style={styles.cornerBL} />
                <View style={styles.cornerBR} />

                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [{ translateY: scanLineTranslateY }],
                    },
                  ]}
                />
              </View>

              <Text style={styles.instruction}>{instruction}</Text>

              {manualActionLabel && onManualAction ? (
                <TouchableOpacity
                  style={styles.manualButton}
                  onPress={onManualAction}
                  activeOpacity={0.9}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={manualActionLabel}
                >
                  <Text weight="semibold" style={styles.manualButtonText}>
                    {manualActionLabel}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

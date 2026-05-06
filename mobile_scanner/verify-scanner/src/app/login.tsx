import React, { useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Text } from '@/components/themed-text';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/constants/theme';
import { authLogin, checkHealth } from '@/services/api';

export default function LoginScreen() {
  const theme = useTheme();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animated shield icon pulse
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Optionally check API health before login
      const healthy = await checkHealth();
      if (!healthy) {
        console.warn('API health check failed, proceeding anyway');
      }

      const res = await authLogin({ email: trimmedEmail, password });
      await login(res.token);
      router.replace('/(app)/scan');
    } catch (e: any) {
      setError(e.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[theme.background, theme.backgroundElement, theme.background]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.content}>
            {/* Logo / Shield */}
            <Animated.View
              style={[styles.logoContainer, { transform: [{ scale: pulseAnim }] }]}
            >
              <View style={[styles.shield, { backgroundColor: theme.primary }]}>
                <Text style={styles.shieldIcon}>🛡️</Text>
              </View>
            </Animated.View>

            <Text weight="bold" size="3xl" style={[styles.appTitle, { color: theme.text }]}>
              VerifyPay
            </Text>
            <Text
              size="md"
              color="secondary"
              style={styles.tagline}
            >
              Ethiopian Payment Receipt Verification
            </Text>

            {/* Card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.borderLight,
                },
              ]}
            >
              <Text weight="semibold" size="lg" style={{ color: theme.text, marginBottom: 6 }}>
                Sign In
              </Text>
              <Text size="sm" color="secondary" style={{ marginBottom: 20, lineHeight: 18 }}>
                Enter your credentials to access the payment verification service.
              </Text>

              <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6 }}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: error ? theme.error : theme.border,
                    color: theme.text,
                    marginBottom: 16,
                  },
                ]}
                placeholder="admin@example.com"
                placeholderTextColor={theme.textTertiary}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                editable={!isLoading}
              />

              <Text weight="medium" size="sm" style={{ color: theme.text, marginBottom: 6 }}>Password</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: error ? theme.error : theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="••••••••"
                placeholderTextColor={theme.textTertiary}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!isLoading}
              />

              {error ? (
                <Text size="sm" style={{ color: theme.error, marginTop: 8 }}>
                  {error}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.button,
                  {
                    backgroundColor: theme.primary,
                    opacity: isLoading ? 0.7 : 1,
                  },
                ]}
                onPress={handleLogin}
                disabled={isLoading}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text weight="semibold" size="lg" style={{ color: '#FFFFFF' }}>
                    Sign In
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Providers marquee */}
            <View style={styles.providersRow}>
              {['CBE', 'Telebirr', 'Dashen', 'BOA', 'M-Pesa', 'CBE Birr'].map((name) => (
                <View
                  key={name}
                  style={[styles.providerChip, { backgroundColor: theme.backgroundElement, borderColor: theme.borderLight }]}
                >
                  <Text size="xs" color="secondary">
                    {name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  logoContainer: {
    marginBottom: 20,
  },
  shield: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  shieldIcon: {
    fontSize: 36,
  },
  appTitle: {
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  tagline: {
    textAlign: 'center',
    marginBottom: 36,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.four,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  input: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  button: {
    height: 52,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  providersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 36,
    paddingHorizontal: 16,
  },
  providerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
});

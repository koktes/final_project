/**
 * API configuration for connecting to the Payment Verification backend.
 * Update BASE_URL to point to your running instance.
 */

// For Android emulator use 10.0.2.2, for physical device use your machine's LAN IP
export const API_BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000'
  : 'https://your-production-api.com';

export const API_ENDPOINTS = {
  verify: '/verify',
  verifyCbe: '/verify-cbe',
  verifyTelebirr: '/verify-telebirr',
  verifyDashen: '/verify-dashen',
  verifyAbyssinia: '/verify-abyssinia',
  verifyCbeBirr: '/verify-cbebirr',
  verifyMpesa: '/verify-mpesa',
  verifyImage: '/verify-image',
  health: '/health',
} as const;

/**
 * Supported payment providers. The universal /verify endpoint
 * auto-detects the provider from the reference format.
 */
export const PROVIDERS = [
  { id: 'cbe', label: 'CBE', color: '#1E40AF' },
  { id: 'telebirr', label: 'Telebirr', color: '#7C3AED' },
  { id: 'dashen', label: 'Dashen Bank', color: '#059669' },
  { id: 'abyssinia', label: 'Bank of Abyssinia', color: '#B45309' },
  { id: 'cbebirr', label: 'CBE Birr', color: '#0891B2' },
  { id: 'mpesa', label: 'M-Pesa', color: '#16A34A' },
] as const;

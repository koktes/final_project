/**
 * API configuration for connecting to the Payment Verification backend.
 * Update BASE_URL to point to your running instance.
 */

// For Android emulator use 10.0.2.2, for physical device use your machine's LAN IP
export const API_BASE_URL = __DEV__
  ? 'http://10.67.126.76:3001'
  : 'https://your-production-api.com';

export const API_ENDPOINTS = {
  authLogin: '/auth/login',
  authRegister: '/auth/register',
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

export interface ProviderField {
  name: string;
  label: string;
  placeholder: string;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
}

export interface ProviderInfo {
  id: string;
  label: string;
  color: string;
  image: any;
  fields: ProviderField[];
}

export const PROVIDERS: ProviderInfo[] = [
  { 
    id: 'cbe', label: 'CBE', color: '#1E40AF', image: require('../../assets/images/banks/CBE.png'),
    fields: [
      { name: 'reference', label: 'Reference Number', placeholder: 'FT...' },
      { name: 'suffix', label: 'Account Suffix (Last 8 digits)', placeholder: '39003377', keyboardType: 'number-pad' }
    ]
  },
  { 
    id: 'telebirr', label: 'Telebirr', color: '#7C3AED', image: require('../../assets/images/banks/telebirr.jpg'),
    fields: [
      { name: 'reference', label: 'Invoice Number', placeholder: 'CIP...' }
    ]
  },
  { 
    id: 'dashen', label: 'Dashen Bank', color: '#059669', image: require('../../assets/images/banks/Dashen.png'),
    fields: [
      { name: 'reference', label: 'FT Ref', placeholder: 'FT...' }
    ]
  },
  { 
    id: 'abyssinia', label: 'Bank of Abyssinia', color: '#B45309', image: require('../../assets/images/banks/Abyssinia.png'),
    fields: [
      { name: 'reference', label: 'Reference Number', placeholder: 'FT...' },
      { name: 'suffix', label: 'Account Suffix (Last 5 digits)', placeholder: '12345', keyboardType: 'number-pad' }
    ]
  },
  { 
    id: 'cbebirr', label: 'CBE Birr', color: '#0891B2', image: require('../../assets/images/banks/CBEBirr.png'),
    fields: [
      { name: 'reference', label: 'Order ID', placeholder: 'DAH...' },
      { name: 'phoneNumber', label: 'Phone Number (251...)', placeholder: '251912345678', keyboardType: 'phone-pad' }
    ]
  },
  { 
    id: 'mpesa', label: 'M-Pesa', color: '#16A34A', image: require('../../assets/images/banks/MPesa.png'),
    fields: [
      { name: 'reference', label: 'Transaction Number', placeholder: 'TD...' }
    ]
  },
];

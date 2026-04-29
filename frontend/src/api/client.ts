const API_BASE = 'http://localhost:3001';

export type BankType = 'cbe' | 'cbe_birr' | 'telebirr' | 'dashen' | 'abyssinia' | 'mpesa';

export interface BankInfo {
  id: BankType;
  name: string;
  shortName: string;
  color: string;
  endpoint: string;
  fields: FieldConfig[];
  refPlaceholder: string;
  refPattern?: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  type: string;
  helpText?: string;
}

export const BANKS: BankInfo[] = [
  {
    id: 'cbe', name: 'Commercial Bank of Ethiopia', shortName: 'CBE',
    color: 'var(--bank-cbe)', endpoint: '/verify-cbe',
    refPlaceholder: 'e.g. FT25188Y8622',
    fields: [
      { name: 'reference', label: 'Reference Number', placeholder: 'FT25188Y8622', required: true, type: 'text' },
      { name: 'accountNumber', label: 'Account Number', placeholder: 'Full account number', required: true, type: 'text', helpText: 'Sender\'s bank account number (we\'ll extract the last 8 digits automatically)' },
    ]
  },
  {
    id: 'cbe_birr', name: 'CBE Birr', shortName: 'CBE Birr',
    color: 'var(--bank-cbebirr)', endpoint: '/verify-cbebirr',
    refPlaceholder: 'e.g. DAH113N6ISR',
    fields: [
      { name: 'reference', label: 'Order ID', placeholder: 'DAH113N6ISR', required: true, type: 'text' },
      { name: 'phoneNumber', label: 'Phone Number', placeholder: '251XXXXXXXXX', required: true, type: 'tel', helpText: 'Sender\'s phone in 251... format' },
    ]
  },
  {
    id: 'telebirr', name: 'Telebirr', shortName: 'Telebirr',
    color: 'var(--bank-telebirr)', endpoint: '/verify-telebirr',
    refPlaceholder: 'e.g. CIP240YHNO',
    fields: [
      { name: 'reference', label: 'Invoice Number', placeholder: 'CIP240YHNO', required: true, type: 'text' },
    ]
  },
  {
    id: 'dashen', name: 'Dashen Bank', shortName: 'Dashen',
    color: 'var(--bank-dashen)', endpoint: '/verify-dashen',
    refPlaceholder: 'e.g. 10116500011833745',
    fields: [
      { name: 'reference', label: 'Transaction ID', placeholder: '10116500011833745', required: true, type: 'text' },
    ]
  },
  {
    id: 'abyssinia', name: 'Bank of Abyssinia', shortName: 'Abyssinia',
    color: 'var(--bank-abyssinia)', endpoint: '/verify-abyssinia',
    refPlaceholder: 'e.g. FT26112L1FGQ',
    fields: [
      { name: 'reference', label: 'Transaction Reference', placeholder: 'FT26112L1FGQ', required: true, type: 'text' },
      { name: 'accountNumber', label: 'Account Number', placeholder: 'Full account number', required: true, type: 'text', helpText: 'Sender\'s bank account number (we\'ll extract the last 5 digits automatically)' },
    ]
  },
  {
    id: 'mpesa', name: 'M-Pesa', shortName: 'M-Pesa',
    color: 'var(--bank-mpesa)', endpoint: '/verify-mpesa',
    refPlaceholder: 'e.g. TD94RNM67E',
    fields: [
      { name: 'reference', label: 'Transaction Number', placeholder: 'TD94RNM67E', required: true, type: 'text' },
    ]
  },
];

export function getBankById(id: BankType): BankInfo {
  return BANKS.find(b => b.id === id)!;
}

export async function verifyManual(bank: BankInfo, formData: Record<string, string>) {
  // Transform accountNumber to the backend's expected suffix format
  const payload: Record<string, string> = { ...formData };
  if (payload.accountNumber) {
    const digits = payload.accountNumber.replace(/\D/g, '');
    if (bank.id === 'cbe') {
      payload.accountSuffix = digits.slice(-8);
    } else if (bank.id === 'abyssinia') {
      payload.suffix = digits.slice(-5);
    }
    delete payload.accountNumber;
  }

  const res = await fetch(`${API_BASE}${bank.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export interface ImageDetectionResult {
  bank?: BankType;
  reference?: string | null;
  referenceLabel?: string;
  confidence?: string;
  source?: string;
  forward_to?: string;
  missingParams?: string[];
  requiredParams?: Record<string, string>;
  hint?: string;
  error?: string;
}

export async function verifyImage(
  file: File,
  extraParams?: Record<string, string>,
  autoVerify = false
): Promise<ImageDetectionResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (extraParams) {
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v) formData.append(k, v);
    });
  }
  const url = `${API_BASE}/verify-image${autoVerify ? '?autoVerify=true' : ''}`;
  const res = await fetch(url, { method: 'POST', body: formData });
  return res.json();
}

export async function verifyImageAutoVerify(
  file: File,
  extraParams?: Record<string, string>
): Promise<any> {
  return verifyImage(file, extraParams, true);
}

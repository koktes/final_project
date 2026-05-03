const API_BASE = 'http://localhost:3001';
const SESSION_KEY = 'verifypay.session';

export interface AuthUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

interface StoredSession {
  token: string;
  user: AuthUser;
}

interface ApiError extends Error {
  status?: number;
}

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const maybeError = (payload as { error?: unknown }).error;
  if (typeof maybeError === 'string' && maybeError.trim()) return maybeError;
  return fallback;
}

function getSession(): StoredSession | null {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getAuthHeaders(): HeadersInit {
  const session = getSession();
  if (!session?.token) return {};
  return { Authorization: `Bearer ${session.token}` };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...getAuthHeaders(),
    },
  });

  const data = await res.json();

  if (!res.ok) {
    const err: ApiError = new Error(parseErrorMessage(data, 'Request failed'));
    err.status = res.status;
    if (res.status === 401) {
      clearSession();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw err;
  }

  return data as T;
}

async function apiFetchBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...getAuthHeaders(),
    },
  });

  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    const err: ApiError = new Error(parseErrorMessage(payload, 'Request failed'));
    err.status = res.status;
    if (res.status === 401) {
      clearSession();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw err;
  }

  return res.blob();
}

function setSession(token: string, user: AuthUser): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export function getStoredUser(): AuthUser | null {
  return getSession()?.user || null;
}

export function getStoredToken(): string | null {
  return getSession()?.token || null;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  setSession(data.token, data.user);
  return data;
}

export async function register(email: string, password: string, name?: string): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

  setSession(data.token, data.user);
  return data;
}

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
    refPlaceholder: 'e.g. FT1234567890',
    fields: [
      { name: 'reference', label: 'FT Ref', placeholder: 'FT1234567890', required: true, type: 'text' },
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

  return apiFetch(bank.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface ImageDetectionResult {
  bank?: BankType;
  reference?: string | null;
  referenceLabel?: string;
  orderId?: string;
  receiptNumber?: string;
  extractedPhoneNumber?: string;
  visionBank?: BankType;
  visionSource?: string;
  visionReference?: string;
  visionReferenceLabel?: string;
  visionConfidence?: string;
  visionOrderId?: string;
  visionReceiptNumber?: string;
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
  autoVerify = false,
  debugVision = false,
  aiOnly = false
): Promise<ImageDetectionResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (extraParams) {
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v) formData.append(k, v);
    });
  }
  const params = new URLSearchParams();
  if (autoVerify) params.set('autoVerify', 'true');
  if (debugVision) params.set('debugVision', 'true');
  if (aiOnly) params.set('aiOnly', 'true');
  const query = params.toString();
  const url = `${API_BASE}/verify-image${query ? `?${query}` : ''}`;
  return apiFetch<ImageDetectionResult>(url.replace(API_BASE, ''), {
    method: 'POST',
    body: formData,
  });
}

export async function verifyImageAutoVerify(
  file: File,
  extraParams?: Record<string, string>,
  aiOnly = false
): Promise<any> {
  return verifyImage(file, extraParams, true, false, aiOnly);
}

export type VerificationStatus = 'SUCCESS' | 'FAILED';
export type VerificationMethod = 'API' | 'MANUAL' | 'IMAGE' | 'BULK' | 'RETRY';

export interface VerificationRecord {
  id: string;
  bank: string;
  reference: string | null;
  status: VerificationStatus;
  method: VerificationMethod;
  amount: number | null;
  payerName: string | null;
  receiverName: string | null;
  phoneNumber: string | null;
  imagePath?: string | null;
  error: string | null;
  createdAt: string;
}

export interface HistoryFilters {
  search?: string;
  bank?: string;
  status?: VerificationStatus | '';
  method?: VerificationMethod | '';
  startDate?: string;
  endDate?: string;
  minAmount?: string;
  maxAmount?: string;
  page?: number;
  pageSize?: number;
  sort?: 'asc' | 'desc';
}

interface HistoryApiResponse {
  success: boolean;
  data: VerificationRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    successCount: number;
    failedCount: number;
  };
}

export async function fetchHistory(filters: HistoryFilters): Promise<HistoryApiResponse> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.bank) params.set('bank', filters.bank);
  if (filters.status) params.set('status', filters.status);
  if (filters.method) params.set('method', filters.method);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.minAmount) params.set('minAmount', filters.minAmount);
  if (filters.maxAmount) params.set('maxAmount', filters.maxAmount);
  params.set('page', String(filters.page || 1));
  params.set('pageSize', String(filters.pageSize || 20));
  params.set('sort', filters.sort || 'desc');

  return apiFetch<HistoryApiResponse>(`/history?${params.toString()}`);
}

export interface HistoryStats {
  total: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalSuccessfulAmount: number;
  averageSuccessfulAmount: number;
  bankBreakdown: Array<{ bank: string; count: number; percent: number }>;
  methodBreakdown: Array<{ method: string; count: number; percent: number }>;
  dailyTrend: Array<{ date: string; count: number }>;
}

interface HistoryStatsResponse {
  success: boolean;
  data: HistoryStats;
}

function toHistoryParams(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.bank) params.set('bank', filters.bank);
  if (filters.status) params.set('status', filters.status);
  if (filters.method) params.set('method', filters.method);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.minAmount) params.set('minAmount', filters.minAmount);
  if (filters.maxAmount) params.set('maxAmount', filters.maxAmount);
  if (filters.sort) params.set('sort', filters.sort);
  return params.toString();
}

export async function fetchHistoryStats(filters: HistoryFilters): Promise<HistoryStats> {
  const query = toHistoryParams(filters);
  const result = await apiFetch<HistoryStatsResponse>(`/history/stats${query ? `?${query}` : ''}`);
  return result.data;
}

export async function exportHistoryCsv(filters: HistoryFilters): Promise<Blob> {
  const query = toHistoryParams(filters);
  return apiFetchBlob(`/history/export.csv${query ? `?${query}` : ''}`);
}

export async function exportHistoryXlsx(filters: HistoryFilters): Promise<Blob> {
  const query = toHistoryParams(filters);
  return apiFetchBlob(`/history/export.xlsx${query ? `?${query}` : ''}`);
}

export async function fetchHistoryImage(recordId: string): Promise<Blob> {
  return apiFetchBlob(`/history/${recordId}/image`);
}

export interface BulkVerifySummary {
  total: number;
  successCount: number;
  failedCount: number;
}

export interface BulkVerifyRowResult {
  row: number;
  bank: string;
  reference: string;
  status: VerificationStatus;
  error?: string | null;
}

export interface BulkVerifyResponse {
  success: boolean;
  summary: BulkVerifySummary;
  results: BulkVerifyRowResult[];
}

export async function bulkVerifyCsv(file: File): Promise<BulkVerifyResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<BulkVerifyResponse>('/bulk/verify', {
    method: 'POST',
    body: formData,
  });
}

export async function retryVerificationRecord(recordId: string): Promise<{ success: boolean; data?: any; updatedRecord?: VerificationRecord }> {
  return apiFetch<{ success: boolean; data?: any; updatedRecord?: VerificationRecord }>(`/history/${recordId}/retry`, {
    method: 'POST',
  });
}

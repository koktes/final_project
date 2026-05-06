import axios from 'axios';
import { API_BASE_URL, API_ENDPOINTS } from '@/constants/api';
import { Platform } from 'react-native';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: {
    id: string;
    email: string;
    name?: string;
  };
  error?: string;
}
export interface VerifyRequest {
  reference: string;
  suffix?: string;
  phoneNumber?: string;
}

export interface VerifyResponse {
  success: boolean;
  provider?: string;
  // CBE fields
  payerName?: string;
  payerAccount?: string;
  receiverName?: string;
  receiverAccount?: string;
  amount?: number;
  paymentDate?: string;
  referenceNumber?: string;
  description?: string;
  // Telebirr fields
  creditedPartyName?: string;
  telebirrNumber?: string;
  bankName?: string;
  status?: string;
  receiptNumber?: string;
  settledAmount?: number;
  serviceFees?: number;
  vat?: number;
  totalPaidAmount?: number;
  // Dashen fields
  senderName?: string;
  senderAccountNumber?: string;
  transactionChannel?: string;
  serviceType?: string;
  narrative?: string;
  phoneNo?: string;
  transactionReference?: string;
  transactionDate?: string;
  transactionAmount?: number;
  serviceCharge?: number;
  total?: number;
  // Generic
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ImageDetectionResult {
  bank?: string;
  reference?: string | null;
  referenceLabel?: string;
  orderId?: string;
  receiptNumber?: string;
  extractedPhoneNumber?: string;
  confidence?: string;
  forward_to?: string;
  missingParams?: string[];
  requiredParams?: Record<string, string>;
  hint?: string;
  error?: string;
}

// Shared axios instance with base config
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
});

/**
 * Authenticates user via email and password.
 */
export async function authLogin(request: LoginRequest): Promise<LoginResponse> {
  try {
    const { data } = await api.post<LoginResponse>(API_ENDPOINTS.authLogin, request);
    return data;
  } catch (err: any) {
    const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Login failed';
    throw new Error(msg);
  }
}

/**
 * Calls the universal /verify endpoint (smart router).
 * The backend auto-detects the provider from the reference format.
 */
export async function verifyPayment(
  request: VerifyRequest,
  token: string
): Promise<VerifyResponse> {
  try {
    const { data } = await api.post<VerifyResponse>(API_ENDPOINTS.verify, request, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (err: any) {
    const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Verification failed';
    throw new Error(msg);
  }
}

/**
 * Check if the backend API is reachable.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const { status } = await api.get(API_ENDPOINTS.health);
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

/**
 * Verify receipt image — sends multipart/form-data to the backend.
 * The backend handles all OCR / AI / bank-API orchestration.
 */
export async function verifyImage(
  uri: string,
  token: string,
  extraParams?: Record<string, string>,
  autoVerify = false
): Promise<any> {
  const formData = new FormData();

  console.log('[verifyImage] Original URI:', uri);
  
  const filename = uri.split('/').pop() || 'receipt.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

  const finalUri = Platform.OS === 'android' && !uri.startsWith('file://') ? `file://${uri}` : uri;
  console.log('[verifyImage] Final URI for FormData:', finalUri);
  console.log('[verifyImage] Filename:', filename, 'MimeType:', mimeType);

  formData.append('file', {
    uri: finalUri,
    name: filename,
    type: mimeType,
  } as any);

  // Attach any extra form fields (suffix, phoneNumber, etc.)
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) {
        console.log(`[verifyImage] Appending extra param: ${k} = ${v}`);
        formData.append(k, v);
      }
    }
  }

  console.log('[verifyImage] Sending request to:', API_ENDPOINTS.verifyImage, 'autoVerify:', autoVerify);
  
  try {
    const response = await api.post(
      API_ENDPOINTS.verifyImage,
      formData,
      {
        params: autoVerify ? { autoVerify: 'true' } : undefined,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        transformRequest: (data) => data, // Prevent axios from transforming FormData to url-encoded
      }
    );
    console.log('[verifyImage] Response OK:', response.status);
    return response.data;
  } catch (err: any) {
    console.log('[verifyImage] ERROR CATCH BLOCK', err.message);
    if (err.response) {
      console.log('[verifyImage] Error Response Data:', err.response.data);
      console.log('[verifyImage] Error Response Status:', err.response.status);
    } else if (err.request) {
      console.log('[verifyImage] Error No Response (Request made but no response received):', err.request);
    } else {
      console.log('[verifyImage] Error Setup:', err.message);
    }
    const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Image verification failed';
    throw new Error(msg);
  }
}

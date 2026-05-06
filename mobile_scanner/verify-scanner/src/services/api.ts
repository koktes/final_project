import { API_BASE_URL, API_ENDPOINTS } from '@/constants/api';

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

/**
 * Authenticates user via email and password.
 */
export async function authLogin(request: LoginRequest): Promise<LoginResponse> {
  const url = `${API_BASE_URL}${API_ENDPOINTS.authLogin}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Login failed (${response.status})`);
  }

  return data as LoginResponse;
}

/**
 * Calls the universal /verify endpoint (smart router).
 * The backend auto-detects the provider from the reference format.
 */
export async function verifyPayment(
  request: VerifyRequest,
  token: string
): Promise<VerifyResponse> {
  const url = `${API_BASE_URL}${API_ENDPOINTS.verify}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Verification failed (${response.status})`);
  }

  return data as VerifyResponse;
}

/**
 * Check if the backend API is reachable.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.health}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

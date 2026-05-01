import { prisma } from '../utils/prisma';
import { Prisma, VerificationMethod, VerificationStatus } from '@prisma/client';

interface LogVerificationInput {
  userId: string;
  bank: string;
  method: VerificationMethod;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  status: VerificationStatus;
  reference?: string | null;
  imagePath?: string | null;
  error?: string | null;
}

function normalizeAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^\d.]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function pickFirst<T>(values: Array<T | undefined | null>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as T;
  }
  return null;
}

function getDetails(payload?: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybeDetails = (payload as any).data || (payload as any).details;
  if (maybeDetails && typeof maybeDetails === 'object') return maybeDetails;
  return payload as Record<string, unknown>;
}

export function extractSummary(payload?: unknown) {
  const details = getDetails(payload) || {};

  const amount = normalizeAmount(
    pickFirst([
      (details as any).amount,
      (details as any).transactionAmount,
      (details as any).total,
      (details as any).settledAmount,
      (details as any).paidAmount,
      (details as any).totalPaidAmount
    ])
  );

  const payerName = pickFirst<string>([
    (details as any).payer,
    (details as any).payerName,
    (details as any).senderName,
    (details as any).sourceAccountName
  ]);

  const receiverName = pickFirst<string>([
    (details as any).receiver,
    (details as any).receiverName,
    (details as any).creditedPartyName
  ]);

  const phoneNumber = pickFirst<string>([
    (details as any).phoneNumber,
    (details as any).payerTelebirrNo,
    (details as any).payerAccount,
    (details as any).receiverAccount,
    (details as any).phoneNo
  ]);

  return { amount, payerName, receiverName, phoneNumber };
}

export async function logVerification(input: LogVerificationInput) {
  const summary = extractSummary(input.responsePayload || null);

  return prisma.verificationRecord.create({
    data: {
      userId: input.userId,
      bank: input.bank,
      reference: input.reference || null,
      status: input.status,
      method: input.method,
      endpoint: input.endpoint || null,
      imagePath: input.imagePath || null,
      requestPayload: input.requestPayload === undefined ? undefined : (input.requestPayload as Prisma.InputJsonValue),
      responsePayload: input.responsePayload === undefined ? undefined : (input.responsePayload as Prisma.InputJsonValue),
      amount: summary.amount ?? undefined,
      payerName: summary.payerName ?? undefined,
      receiverName: summary.receiverName ?? undefined,
      phoneNumber: summary.phoneNumber ?? undefined,
      error: input.error || null
    }
  });
}

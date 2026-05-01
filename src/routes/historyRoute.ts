import { Router, Request, Response } from 'express';
import { Prisma, VerificationMethod, VerificationStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { AuthenticatedRequest } from '../middleware/jwtAuth';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { logVerification, extractSummary } from '../services/verificationRecords';
import { verifyCBE } from '../services/verifyCBE';
import { verifyTelebirr } from '../services/verifyTelebirr';
import { verifyDashen } from '../services/verifyDashen';
import { verifyAbyssinia } from '../services/verifyAbyssinia';
import { verifyCBEBirr } from '../services/verifyCBEBirr';
import { verifyMpesa } from '../services/verifyMpesa';

const router = Router();

interface HistoryQuery {
  search?: string;
  bank?: string;
  status?: string;
  method?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: string;
  maxAmount?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function asStatus(value: string | undefined): VerificationStatus | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper === VerificationStatus.SUCCESS || upper === VerificationStatus.FAILED) {
    return upper as VerificationStatus;
  }
  return undefined;
}

function asMethod(value: string | undefined): VerificationMethod | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  const allowed = new Set(Object.values(VerificationMethod));
  if (allowed.has(upper as VerificationMethod)) {
    return upper as VerificationMethod;
  }
  return undefined;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildWhere(userId: string, query: HistoryQuery): Prisma.VerificationRecordWhereInput {
  const {
    search,
    bank,
    status,
    method,
    startDate,
    endDate,
    minAmount,
    maxAmount,
  } = query;

  const parsedStatus = asStatus(status);
  const parsedMethod = asMethod(method);
  const parsedStartDate = parseDate(startDate);
  const parsedEndDate = parseDate(endDate);
  const parsedMinAmount = parseAmount(minAmount);
  const parsedMaxAmount = parseAmount(maxAmount);

  const where: Prisma.VerificationRecordWhereInput = {
    userId,
  };

  if (bank) {
    where.bank = { equals: bank, mode: 'insensitive' };
  }

  if (parsedStatus) {
    where.status = parsedStatus;
  }

  if (parsedMethod) {
    where.method = parsedMethod;
  }

  if (parsedStartDate || parsedEndDate) {
    where.createdAt = {
      gte: parsedStartDate,
      lte: parsedEndDate,
    };
  }

  if (parsedMinAmount !== undefined || parsedMaxAmount !== undefined) {
    where.amount = {
      gte: parsedMinAmount,
      lte: parsedMaxAmount,
    };
  }

  if (search && search.trim()) {
    const searchTerm = search.trim();
    where.OR = [
      { reference: { contains: searchTerm, mode: 'insensitive' } },
      { payerName: { contains: searchTerm, mode: 'insensitive' } },
      { receiverName: { contains: searchTerm, mode: 'insensitive' } },
      { phoneNumber: { contains: searchTerm, mode: 'insensitive' } },
      { bank: { contains: searchTerm, mode: 'insensitive' } },
      { error: { contains: searchTerm, mode: 'insensitive' } },
    ];
  }

  return where;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function lastDigits(value: string | null, count: number): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < count) return null;
  return digits.slice(-count);
}

function normalizeBank(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

router.get('/stats', async (req: Request<{}, {}, {}, HistoryQuery>, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const where = buildWhere(userId, req.query);

  try {
    const [total, successCount, failedCount, amountAgg, bankBreakdownRaw, methodBreakdownRaw] = await Promise.all([
      prisma.verificationRecord.count({ where }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.SUCCESS } }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.FAILED } }),
      prisma.verificationRecord.aggregate({
        where: { ...where, status: VerificationStatus.SUCCESS },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.verificationRecord.groupBy({
        by: ['bank'],
        where,
        _count: { _all: true },
        orderBy: { _count: { bank: 'desc' } },
      }),
      prisma.verificationRecord.groupBy({
        by: ['method'],
        where,
        _count: { _all: true },
      }),
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recent = await prisma.verificationRecord.findMany({
      where: {
        ...where,
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
      select: {
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const dayMap = new Map<string, number>();
    for (const row of recent) {
      const day = row.createdAt.toISOString().slice(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }

    const dailyTrend = Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));

    const bankBreakdown = bankBreakdownRaw.map((row) => ({
      bank: row.bank,
      count: row._count._all,
      percent: total > 0 ? Number(((row._count._all / total) * 100).toFixed(1)) : 0,
    }));

    const methodBreakdown = methodBreakdownRaw.map((row) => ({
      method: row.method,
      count: row._count._all,
      percent: total > 0 ? Number(((row._count._all / total) * 100).toFixed(1)) : 0,
    }));

    const successRate = total > 0 ? Number(((successCount / total) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        total,
        successCount,
        failedCount,
        successRate,
        totalSuccessfulAmount: amountAgg._sum.amount || 0,
        averageSuccessfulAmount: amountAgg._avg.amount || 0,
        bankBreakdown,
        methodBreakdown,
        dailyTrend,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch report stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch report stats' });
  }
});

router.get('/:id/image', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const recordId = String(req.params.id);

  const record = await prisma.verificationRecord.findFirst({
    where: { id: recordId, userId },
    select: { imagePath: true },
  });

  if (!record?.imagePath) {
    res.status(404).json({ success: false, error: 'Image not available' });
    return;
  }

  const uploadsRoot = path.resolve(process.cwd(), 'uploads');
  const resolved = path.resolve(process.cwd(), record.imagePath);

  if (!resolved.startsWith(uploadsRoot)) {
    res.status(400).json({ success: false, error: 'Invalid image path' });
    return;
  }

  if (!fs.existsSync(resolved)) {
    res.status(404).json({ success: false, error: 'Image file not found' });
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(resolved);
});

router.post('/:id/retry', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const recordId = String(req.params.id);
  const record = await prisma.verificationRecord.findFirst({
    where: { id: recordId, userId },
  });

  if (!record) {
    res.status(404).json({ success: false, error: 'Record not found' });
    return;
  }

  if (record.status === VerificationStatus.SUCCESS) {
    res.status(400).json({ success: false, error: 'Record is already successful' });
    return;
  }

  const payload = record.requestPayload && typeof record.requestPayload === 'object'
    ? record.requestPayload as Record<string, unknown>
    : {};
  const suppliedParams = payload.suppliedParams && typeof payload.suppliedParams === 'object'
    ? payload.suppliedParams as Record<string, unknown>
    : {};

  const bank = normalizeBank(record.bank);
  const reference = normalizeString(record.reference)
    || normalizeString(payload.reference)
    || normalizeString(payload.receiptNumber)
    || normalizeString(payload.orderId)
    || normalizeString(payload.ftRef);

  const accountNumber = normalizeString(payload.accountNumber) || normalizeString(suppliedParams.accountNumber);
  const phoneNumber = normalizeString(payload.phoneNumber) || normalizeString(suppliedParams.phoneNumber);

  if (!reference) {
    res.status(400).json({ success: false, error: 'Missing reference for retry' });
    return;
  }

  let responsePayload: unknown = null;
  let success = false;
  let errorMessage: string | null = null;

  try {
    switch (bank) {
      case 'cbe': {
        const accountSuffix = normalizeString(payload.accountSuffix) || lastDigits(accountNumber, 8);
        if (!accountSuffix) {
          errorMessage = 'Missing account suffix for CBE retry';
          break;
        }
        const result = await verifyCBE(reference, accountSuffix);
        responsePayload = result;
        success = result.success;
        errorMessage = result.success ? null : result.error || 'Verification failed';
        break;
      }
      case 'abyssinia': {
        const suffix = normalizeString(payload.suffix) || lastDigits(accountNumber, 5);
        if (!suffix) {
          errorMessage = 'Missing account suffix for Abyssinia retry';
          break;
        }
        const result = await verifyAbyssinia(reference, suffix);
        responsePayload = result;
        success = result.success;
        errorMessage = result.success ? null : result.error || 'Verification failed';
        break;
      }
      case 'cbe_birr':
      case 'cbebirr': {
        if (!phoneNumber) {
          errorMessage = 'Missing phone number for CBE Birr retry';
          break;
        }
        const result = await verifyCBEBirr(reference, phoneNumber);
        responsePayload = result;
        success = !("success" in (result as any) && (result as any).success === false);
        errorMessage = success ? null : (result as { error?: string }).error || 'Verification failed';
        break;
      }
      case 'telebirr': {
        const result = await verifyTelebirr(reference);
        responsePayload = result || null;
        success = Boolean(result);
        errorMessage = success ? null : 'Receipt not found or could not be processed';
        break;
      }
      case 'dashen': {
        const result = await verifyDashen(reference);
        responsePayload = result;
        success = result.success;
        errorMessage = result.success ? null : result.error || 'Verification failed';
        break;
      }
      case 'mpesa': {
        const result = await verifyMpesa(reference);
        responsePayload = result;
        success = result.success;
        errorMessage = result.success ? null : result.error || 'Verification failed';
        break;
      }
      default:
        errorMessage = `Unsupported bank for retry: ${record.bank}`;
    }
  } catch (error) {
    logger.error('Retry verification failed', error);
    errorMessage = 'Retry verification failed';
  }

  if (!success) {
    // Do not persist a failed retry - leave the original record unchanged.
    res.status(502).json({ success: false, error: errorMessage || 'Retry failed' });
    return;
  }

  // On success, replace the existing record with the verified response.
  try {
    // Compute summary fields from the response payload so we can update the record row.
    const summary = extractSummary(responsePayload as unknown);

    const updated = await prisma.verificationRecord.update({
      where: { id: record.id },
      data: {
        status: VerificationStatus.SUCCESS,
        method: 'RETRY',
        responsePayload: responsePayload === undefined ? undefined : (responsePayload as Prisma.InputJsonValue),
        amount: summary.amount ?? undefined,
        payerName: summary.payerName ?? undefined,
        receiverName: summary.receiverName ?? undefined,
        phoneNumber: summary.phoneNumber ?? undefined,
        error: null,
        retryCount: { increment: 1 },
        lastRetriedAt: new Date(),
      },
    });

    res.json({ success: true, data: responsePayload, updatedRecord: updated });
    return;
  } catch (err) {
    logger.error('Failed to persist retry result:', err);
    res.status(500).json({ success: false, error: 'Failed to update record after retry' });
    return;
  }
});

router.get('/export.csv', async (req: Request<{}, {}, {}, HistoryQuery>, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const where = buildWhere(userId, req.query);

  try {
    const [records, total, successCount, failedCount, totalAgg, successAgg] = await Promise.all([
      prisma.verificationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10000,
        select: {
          id: true,
          createdAt: true,
          bank: true,
          reference: true,
          status: true,
          method: true,
          amount: true,
          payerName: true,
          receiverName: true,
          phoneNumber: true,
          imagePath: true,
          error: true,
        },
      }),
      prisma.verificationRecord.count({ where }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.SUCCESS } }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.FAILED } }),
      prisma.verificationRecord.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.verificationRecord.aggregate({
        where: { ...where, status: VerificationStatus.SUCCESS },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
    ]);

    const header = [
      'id',
      'createdAt',
      'bank',
      'reference',
      'status',
      'method',
      'amount',
      'payerName',
      'receiverName',
      'phoneNumber',
      'imageUrl',
      'error',
    ];

    const rows = records.map((record) => [
      record.id,
      record.createdAt.toISOString(),
      record.bank,
      record.reference,
      record.status,
      record.method,
      record.amount,
      record.payerName,
      record.receiverName,
      record.phoneNumber,
      record.imagePath ? `/history/${record.id}/image` : '',
      record.error,
    ].map(escapeCsvCell).join(','));

    const csv = [header.join(','), ...rows].join('\n');

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `verification-history-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('Failed to export history CSV:', error);
    res.status(500).json({ success: false, error: 'Failed to export history CSV' });
  }
});

router.get('/export.xlsx', async (req: Request<{}, {}, {}, HistoryQuery>, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const where = buildWhere(userId, req.query);

  try {
    const [records, total, successCount, failedCount, totalAgg, successAgg] = await Promise.all([
      prisma.verificationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10000,
        select: {
          id: true,
          createdAt: true,
          bank: true,
          reference: true,
          status: true,
          method: true,
          amount: true,
          payerName: true,
          receiverName: true,
          phoneNumber: true,
          imagePath: true,
          error: true,
        },
      }),
      prisma.verificationRecord.count({ where }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.SUCCESS } }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.FAILED } }),
      prisma.verificationRecord.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.verificationRecord.aggregate({
        where: { ...where, status: VerificationStatus.SUCCESS },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
    ]);

    const rows = records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt.toISOString(),
      bank: record.bank,
      reference: record.reference || '',
      status: record.status,
      method: record.method,
      amount: record.amount ?? '',
      payerName: record.payerName || '',
      receiverName: record.receiverName || '',
      phoneNumber: record.phoneNumber || '',
      imageUrl: record.imagePath ? `/history/${record.id}/image` : '',
      error: record.error || '',
    }));

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 20 },
      { wch: 22 },
      { wch: 14 },
      { wch: 20 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 28 },
      { wch: 24 },
    ];
    xlsx.utils.book_append_sheet(workbook, worksheet, 'History');

    const summaryRows = [
      { metric: 'Total records', value: total },
      { metric: 'Success count', value: successCount },
      { metric: 'Failed count', value: failedCount },
      { metric: 'Success rate (%)', value: total > 0 ? Number(((successCount / total) * 100).toFixed(1)) : 0 },
      { metric: 'Total amount', value: totalAgg._sum.amount || 0 },
      { metric: 'Average amount', value: totalAgg._avg.amount || 0 },
      { metric: 'Successful total amount', value: successAgg._sum.amount || 0 },
      { metric: 'Successful average amount', value: successAgg._avg.amount || 0 },
      { metric: 'Exported at', value: new Date().toISOString() },
    ];

    const summarySheet = xlsx.utils.json_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 26 }, { wch: 20 }];
    xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `verification-history-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    logger.error('Failed to export history XLSX:', error);
    res.status(500).json({ success: false, error: 'Failed to export history XLSX' });
  }
});

router.get('/', async (req: Request<{}, {}, {}, HistoryQuery>, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const { sort } = req.query;

  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
  const skip = (page - 1) * pageSize;

  const where = buildWhere(userId, req.query);

  const orderBy: Prisma.VerificationRecordOrderByWithRelationInput = {
    createdAt: sort?.toLowerCase() === 'asc' ? 'asc' : 'desc',
  };

  try {
    const [records, total, successCount, failedCount] = await Promise.all([
      prisma.verificationRecord.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          bank: true,
          reference: true,
          status: true,
          method: true,
          amount: true,
          payerName: true,
          receiverName: true,
          phoneNumber: true,
          imagePath: true,
          error: true,
        },
      }),
      prisma.verificationRecord.count({ where }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.SUCCESS } }),
      prisma.verificationRecord.count({ where: { ...where, status: VerificationStatus.FAILED } }),
    ]);

    res.json({
      success: true,
      data: records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      },
      summary: {
        successCount,
        failedCount,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch verification history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch verification history' });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { AuthenticatedRequest } from '../middleware/jwtAuth';
import { logVerification } from '../services/verificationRecords';
import { verifyCBE } from '../services/verifyCBE';
import { verifyTelebirr } from '../services/verifyTelebirr';
import { verifyDashen } from '../services/verifyDashen';
import { verifyAbyssinia } from '../services/verifyAbyssinia';
import { verifyCBEBirr } from '../services/verifyCBEBirr';
import { verifyMpesa } from '../services/verifyMpesa';
import logger from '../utils/logger';

const router = Router();
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 2 * 1024 * 1024 },
});

const MAX_BULK_ROWS = 200;

type NormalizedRow = Record<string, string>;

function normalizeRow(row: Record<string, unknown>): NormalizedRow {
  const normalized: NormalizedRow = {};
  for (const [key, value] of Object.entries(row)) {
    const cleanedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
    normalized[cleanedKey] = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }
  return normalized;
}

function normalizeBank(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return null;
  if (normalized === 'cbe') return 'cbe';
  if (normalized === 'telebirr') return 'telebirr';
  if (normalized === 'dashen') return 'dashen';
  if (normalized === 'abyssinia' || normalized === 'bank_of_abyssinia') return 'abyssinia';
  if (normalized === 'mpesa' || normalized === 'm-pesa') return 'mpesa';
  if (normalized === 'cbe_birr' || normalized === 'cbebirr' || normalized === 'cbe-birr') return 'cbe_birr';
  return null;
}

function getValue(row: NormalizedRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function lastDigits(value: string | null, count: number): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < count) return null;
  return digits.slice(-count);
}

router.post('/verify', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ success: false, error: 'CSV file is required' });
    return;
  }

  const filePath = req.file.path;

  try {
    const csvText = fs.readFileSync(filePath, 'utf8');
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, unknown>[];

    if (!rows.length) {
      res.status(400).json({ success: false, error: 'CSV file is empty' });
      return;
    }

    if (rows.length > MAX_BULK_ROWS) {
      res.status(400).json({ success: false, error: `CSV exceeds ${MAX_BULK_ROWS} rows` });
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const normalized = normalizeRow(rows[index]);
      const bankRaw = getValue(normalized, ['bank', 'provider', 'type']);
      const bank = bankRaw ? normalizeBank(bankRaw) : null;
      const reference = getValue(normalized, ['reference', 'ref', 'transaction_reference', 'ft_ref', 'ftref']);
      const accountNumber = getValue(normalized, ['accountnumber', 'account_number']);
      const accountSuffix = getValue(normalized, ['accountsuffix', 'account_suffix']) || lastDigits(accountNumber, 8);
      const suffix = getValue(normalized, ['suffix']) || lastDigits(accountNumber, 5);
      const phoneNumber = getValue(normalized, ['phonenumber', 'phone_number', 'phone']);

      if (!bank || !reference) {
        results.push({
          row: index + 1,
          bank: bankRaw || null,
          reference: reference || null,
          status: 'FAILED',
          error: 'Missing bank or reference'
        });
        failedCount += 1;
        continue;
      }

      let responsePayload: unknown = null;
      let success = false;
      let errorMessage: string | null = null;

      try {
        switch (bank) {
          case 'cbe': {
            if (!accountSuffix) {
              errorMessage = 'Missing account suffix for CBE';
              break;
            }
            const result = await verifyCBE(reference, accountSuffix);
            responsePayload = result;
            success = result.success;
            errorMessage = result.success ? null : result.error || 'Verification failed';
            break;
          }
          case 'abyssinia': {
            if (!suffix) {
              errorMessage = 'Missing account suffix for Abyssinia';
              break;
            }
            const result = await verifyAbyssinia(reference, suffix);
            responsePayload = result;
            success = result.success;
            errorMessage = result.success ? null : result.error || 'Verification failed';
            break;
          }
          case 'cbe_birr': {
            if (!phoneNumber) {
              errorMessage = 'Missing phone number for CBE Birr';
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
            errorMessage = `Unsupported bank: ${bank}`;
        }
      } catch (error) {
        logger.error('Bulk verification row failed', error);
        errorMessage = 'Verification failed';
      }

      await logVerification({
        userId,
        bank,
        method: 'BULK',
        endpoint: '/bulk/verify',
        requestPayload: normalized,
        responsePayload,
        status: success ? 'SUCCESS' : 'FAILED',
        reference,
        error: success ? null : errorMessage || 'Verification failed'
      });

      if (success) {
        successCount += 1;
      } else {
        failedCount += 1;
      }

      results.push({
        row: index + 1,
        bank,
        reference,
        status: success ? 'SUCCESS' : 'FAILED',
        error: success ? null : errorMessage,
      });
    }

    res.json({
      success: true,
      summary: {
        total: rows.length,
        successCount,
        failedCount,
      },
      results,
    });
  } catch (error) {
    logger.error('Bulk verification failed', error);
    res.status(500).json({ success: false, error: 'Bulk verification failed' });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      logger.warn('Failed to remove bulk CSV file', cleanupError);
    }
  }
});

export default router;

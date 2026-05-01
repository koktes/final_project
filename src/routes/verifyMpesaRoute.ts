import { Router, Request, Response } from 'express';
import { verifyMpesa } from '../services/verifyMpesa';
import { logVerification } from '../services/verificationRecords';
import { AuthenticatedRequest } from '../middleware/jwtAuth';
import logger from '../utils/logger';

const router = Router();

interface VerifyRequestBody {
    reference: string;
}

// POST /verify-mpesa
router.post('/', async function (
    req: Request<{}, {}, VerifyRequestBody>,
    res: Response
): Promise<void> {
    const { reference } = req.body;

    if (!reference) {
        res.status(400).json({
            success: false,
            error: 'Transaction reference is required'
        });
        return;
    }

    try {
        logger.info(`🔍 Verifying M-Pesa transaction: ${reference}`);
        const result = await verifyMpesa(reference);

        const authReq = req as AuthenticatedRequest;
        if (authReq.user?.id) {
            await logVerification({
                userId: authReq.user.id,
                bank: 'mpesa',
                method: 'MANUAL',
                endpoint: '/verify-mpesa',
                requestPayload: req.body,
                responsePayload: result,
                status: result.success ? 'SUCCESS' : 'FAILED',
                reference,
                error: result.success ? null : result.error || 'Verification failed'
            });
        }

        if (result.success) {
            logger.info(`✅ M-Pesa verification successful for: ${reference}`);
        } else {
            logger.warn(`❌ M-Pesa verification failed for: ${reference} - ${result.error}`);
        }

        res.json(result);
    } catch (error: any) {
        logger.error(`💥 M-Pesa verification error for ${reference}:`, error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error during verification'
        });
    }
});

// GET /verify-mpesa (for testing with query parameters)
router.get('/', async function (
    req: Request<{}, {}, {}, { reference?: string }>,
    res: Response
): Promise<void> {
    const { reference } = req.query;

    if (!reference || typeof reference !== 'string') {
        res.status(400).json({
            success: false,
            error: 'Transaction reference is required as query parameter'
        });
        return;
    }

    try {
        logger.info(`🔍 Verifying M-Pesa transaction (GET): ${reference}`);
        const result = await verifyMpesa(reference);

        const authReq = req as AuthenticatedRequest;
        if (authReq.user?.id) {
            await logVerification({
                userId: authReq.user.id,
                bank: 'mpesa',
                method: 'MANUAL',
                endpoint: '/verify-mpesa',
                requestPayload: req.query as Record<string, string>,
                responsePayload: result,
                status: result.success ? 'SUCCESS' : 'FAILED',
                reference,
                error: result.success ? null : result.error || 'Verification failed'
            });
        }

        if (result.success) {
            logger.info(`✅ M-Pesa verification successful for: ${reference}`);
        } else {
            logger.warn(`❌ M-Pesa verification failed for: ${reference} - ${result.error}`);
        }

        res.json(result);
    } catch (error: any) {
        logger.error(`💥 M-Pesa verification error for ${reference}:`, error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error during verification'
        });
    }
});

export default router;